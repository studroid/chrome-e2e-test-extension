class E2ETestRecorder {
  constructor() {
    this.isRecording = false;
    this.currentTest = null;
    this.tests = [];
    this.init();
  }

  async init() {
    await this.loadTests();
    await this.loadRecordingState();
    this.setupEventListeners();
    this.updateUI();
  }

  async loadTests() {
    const result = await chrome.storage.local.get(['e2eTests']);
    this.tests = result.e2eTests || [];
  }

  async loadRecordingState() {
    const result = await chrome.storage.local.get(['recordingState']);
    const state = result.recordingState;

    if (state && state.isRecording) {
      this.isRecording = true;
      this.currentTest = state.currentTest;
      document.getElementById('testName').value = state.currentTest?.name || '';
    }
  }

  async saveRecordingState() {
    await chrome.storage.local.set({
      recordingState: {
        isRecording: this.isRecording,
        currentTest: this.currentTest
      }
    });
  }

  async saveTests() {
    await chrome.storage.local.set({ e2eTests: this.tests });
  }

  setupEventListeners() {
    document.getElementById('startRecording').addEventListener('click', () => this.startRecording());
    document.getElementById('stopRecording').addEventListener('click', () => this.stopRecording());
    document.getElementById('importTests').addEventListener('click', () => this.importTests());
    document.getElementById('exportAllTests').addEventListener('click', () => this.exportAllTests());
    document.getElementById('clearTests').addEventListener('click', () => this.clearAllTests());

    document.getElementById('testName').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.startRecording();
      }
    });

    document.getElementById('fileInput').addEventListener('change', (e) => this.handleFileUpload(e));
  }

  async startRecording() {
    const testName = document.getElementById('testName').value.trim();
    if (!testName) {
      alert('Please enter a test name');
      return;
    }

    this.isRecording = true;
    this.currentTest = {
      name: testName,
      steps: [],
      timestamp: new Date().toISOString(),
      url: await this.getCurrentTabUrl()
    };

    await this.sendMessageToActiveTab({ action: 'startRecording', testName });
    await this.saveRecordingState();

    this.updateUI();
    document.getElementById('testName').value = '';
  }

  async stopRecording() {
    if (!this.isRecording || !this.currentTest) return;

    this.isRecording = false;

    await this.sendMessageToActiveTab({ action: 'stopRecording' });

    const result = await chrome.storage.local.get([`recording_${this.currentTest.name}`]);
    const recordedSteps = result[`recording_${this.currentTest.name}`] || [];

    this.currentTest.steps = recordedSteps;
    this.tests.push(this.currentTest);
    await this.saveTests();

    await chrome.storage.local.remove([`recording_${this.currentTest.name}`]);

    this.currentTest = null;
    await this.saveRecordingState();
    this.updateUI();
  }

  async clearAllTests() {
    if (confirm('Are you sure you want to clear all tests?')) {
      this.tests = [];
      await this.saveTests();
      this.updateUI();
    }
  }

  importTests() {
    document.getElementById('fileInput').click();
  }

  async handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const text = await this.readFileAsText(file);
      const importedData = JSON.parse(text);

      if (this.validateImportedData(importedData)) {
        await this.processImportedTests(importedData);
      } else {
        alert('Invalid test data format. Please select a valid test file.');
      }
    } catch (error) {
      console.error('Import failed:', error);
      alert('Failed to import test data. Please check the file format.');
    }

    // Clear the file input
    event.target.value = '';
  }

  readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(e);
      reader.readAsText(file);
    });
  }

  validateImportedData(data) {
    // Check if it's a single test object
    if (data.name && data.steps && Array.isArray(data.steps)) {
      return true;
    }

    // Check if it's an array of tests
    if (Array.isArray(data)) {
      return data.every(test =>
        test.name &&
        test.steps &&
        Array.isArray(test.steps) &&
        test.steps.every(step =>
          step.type &&
          step.selector &&
          step.timestamp
        )
      );
    }

    // Check if it's an export format with tests array
    if (data.tests && Array.isArray(data.tests)) {
      return this.validateImportedData(data.tests);
    }

    return false;
  }

  async processImportedTests(data) {
    let testsToImport = [];

    // Handle single test
    if (data.name && data.steps) {
      testsToImport = [data];
    }
    // Handle array of tests
    else if (Array.isArray(data)) {
      testsToImport = data;
    }
    // Handle export format
    else if (data.tests && Array.isArray(data.tests)) {
      testsToImport = data.tests;
    }

    if (testsToImport.length === 0) {
      alert('No valid tests found in the file.');
      return;
    }

    // Check for duplicate names
    const existingNames = this.tests.map(test => test.name);
    const duplicates = testsToImport.filter(test => existingNames.includes(test.name));

    let shouldProceed = true;
    if (duplicates.length > 0) {
      const duplicateNames = duplicates.map(test => test.name).join(', ');
      shouldProceed = confirm(
        `The following tests already exist and will be overwritten:\n${duplicateNames}\n\nDo you want to continue?`
      );
    }

    if (!shouldProceed) return;

    // Remove duplicates from existing tests
    this.tests = this.tests.filter(test =>
      !testsToImport.some(importedTest => importedTest.name === test.name)
    );

    // Add imported tests
    this.tests.push(...testsToImport);

    await this.saveTests();
    this.updateUI();

    alert(`Successfully imported ${testsToImport.length} test(s).`);
  }

  async exportAllTests() {
    if (this.tests.length === 0) {
      alert('No tests to export.');
      return;
    }

    try {
      const exportData = {
        format: 'e2e-test-recorder',
        version: '1.0.0',
        exportDate: new Date().toISOString(),
        totalTests: this.tests.length,
        tests: this.tests
      };

      const testData = JSON.stringify(exportData, null, 2);
      const blob = new Blob([testData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const a = document.createElement('a');
      a.href = url;
      a.download = `e2e-tests-${timestamp}.json`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export all failed:', error);
      alert('Failed to export all tests.');
    }
  }

  async replayTest(test) {
    try {
      await this.sendMessageToActiveTab({
        action: 'replayTest',
        test: test
      });
    } catch (error) {
      console.error('Replay failed:', error);
      alert('Failed to replay test. Make sure you are on a supported web page.');
    }
  }

  async deleteTest(index) {
    if (confirm(`Delete test "${this.tests[index].name}"?`)) {
      this.tests.splice(index, 1);
      await this.saveTests();
      this.updateUI();
    }
  }

  async exportTest(test) {
    try {
      const testData = JSON.stringify(test, null, 2);
      const blob = new Blob([testData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `${test.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
      alert('Failed to export test data.');
    }
  }

  async getCurrentTabUrl() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab.url;
  }

  async sendMessageToActiveTab(message) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        throw new Error('No active tab found');
      }

      // Check if the tab URL is supported
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('moz-extension://') || tab.url.startsWith('edge://')) {
        throw new Error('Extension pages are not supported');
      }

      return await chrome.tabs.sendMessage(tab.id, message);
    } catch (error) {
      console.error('Failed to send message to tab:', error);
      throw error;
    }
  }

  updateUI() {
    const statusElement = document.getElementById('status');
    const startButton = document.getElementById('startRecording');
    const stopButton = document.getElementById('stopRecording');
    const testListElement = document.getElementById('testList');
    const testNameInput = document.getElementById('testName');

    if (this.isRecording && this.currentTest) {
      statusElement.textContent = `Recording: ${this.currentTest.name}`;
      statusElement.className = 'status recording';
      startButton.disabled = true;
      stopButton.disabled = false;
      testNameInput.disabled = true;
      testNameInput.value = this.currentTest.name;
    } else {
      statusElement.textContent = 'Ready to record';
      statusElement.className = 'status idle';
      startButton.disabled = false;
      stopButton.disabled = true;
      testNameInput.disabled = false;
    }

    this.renderTestList(testListElement);
  }

  renderTestList(container) {
    if (this.tests.length === 0) {
      container.innerHTML = '<div class="empty-state">No tests recorded yet</div>';
      return;
    }

    container.innerHTML = this.tests.map((test, index) => `
      <div class="test-item">
        <div>
          <div class="test-name">${this.escapeHtml(test.name)}</div>
          <div style="font-size: 12px; color: #6b7280;">
            ${test.steps.length} steps • ${new Date(test.timestamp).toLocaleDateString()}
          </div>
        </div>
        <div class="test-actions">
          <button class="btn-primary" data-action="replay" data-index="${index}">
            Replay
          </button>
          <button class="btn-secondary" data-action="export" data-index="${index}">
            Export
          </button>
          <button class="btn-danger" data-action="delete" data-index="${index}">
            Delete
          </button>
        </div>
      </div>
    `).join('');

    // Add event listeners for all buttons
    container.querySelectorAll('button[data-action]').forEach(button => {
      button.addEventListener('click', (e) => {
        const action = e.target.getAttribute('data-action');
        const index = parseInt(e.target.getAttribute('data-index'));

        switch (action) {
          case 'replay':
            this.replayTest(this.tests[index]);
            break;
          case 'export':
            this.exportTest(this.tests[index]);
            break;
          case 'delete':
            this.deleteTest(index);
            break;
        }
      });
    });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

const recorder = new E2ETestRecorder();