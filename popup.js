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
      this.originalWindowSize = state.originalWindowSize; // 원래 윈도우 크기 복원
      document.getElementById('testName').value = state.currentTest?.name || '';
    }
  }

  async saveRecordingState() {
    await chrome.storage.local.set({
      recordingState: {
        isRecording: this.isRecording,
        currentTest: this.currentTest,
        originalWindowSize: this.originalWindowSize // 원래 윈도우 크기도 저장
      }
    });
  }

  async saveTests() {
    await chrome.storage.local.set({ e2eTests: this.tests });
  }

  setupEventListeners() {
    document.getElementById('startRecording').addEventListener('click', () => this.startRecording());
    document.getElementById('stopRecording').addEventListener('click', () => this.stopRecording());
    document.getElementById('captureScreenshot').addEventListener('click', () => this.captureScreenshot());
    document.getElementById('importTests').addEventListener('click', () => this.importTests());
    document.getElementById('exportAllTests').addEventListener('click', () => this.exportAllTests());
    document.getElementById('viewScreenshots').addEventListener('click', () => this.showScreenshotGallery());
    document.getElementById('clearTests').addEventListener('click', () => this.clearAllTests());
    document.getElementById('closeGallery').addEventListener('click', () => this.hideScreenshotGallery());

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

    // Prevent double-clicking by disabling button temporarily
    const startButton = document.getElementById('startRecording');
    if (startButton.disabled || this.isRecording) {
      return;
    }

    try {
      startButton.disabled = true;
      this.showNotification('Setting up recording...', 'info');

      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab) {
        throw new Error('No active tab found');
      }

      this.showNotification('Tab found, setting up recording...', 'info');

      // Set recording state FIRST
      this.isRecording = true;
      this.currentTest = {
        name: testName,
        steps: [],
        timestamp: new Date().toISOString(),
        url: tab.url,
        screenshots: []
      };

      this.showNotification('Recording state set, saving...', 'info');

      // Save state
      await this.saveRecordingState();

      this.showNotification('State saved, updating UI...', 'info');

      // Update UI
      this.updateUI();
      document.getElementById('testName').value = '';

      this.showNotification('UI updated, starting content script...', 'info');

      // Start recording in content script
      try {
        const result = await this.sendMessageToActiveTab({
          action: 'startRecording',
          testName
        });
        this.showNotification('Content script started successfully!', 'success');
      } catch (contentError) {
        this.showNotification('Content script failed, but recording state is active', 'info');
        console.error('Content script failed:', contentError);
      }

      this.showNotification(`Recording started: ${testName}`, 'success');

      // NOW resize browser after everything is set up
      this.showNotification('Resizing browser for consistent testing...', 'info');

      try {
        const window = await chrome.windows.get(tab.windowId);

        // Store original size for restoration
        this.originalWindowSize = {
          width: window.width,
          height: window.height,
          left: window.left,
          top: window.top
        };

        // Save original size to storage as well
        await this.saveRecordingState();

        // Resize to standard testing size
        await chrome.windows.update(tab.windowId, {
          width: 1280,
          height: 800,
          state: 'normal'
        });

        this.showNotification('Browser resized to 1280x720 for testing', 'success');

      } catch (resizeError) {
        console.error('Window resize failed:', resizeError);
        this.showNotification('Recording active, but resize failed', 'info');
        // Continue - recording is already active
      }

    } catch (error) {
      console.error('Failed to start recording:', error);
      this.showNotification(`Recording failed: ${error.message}`, 'error');
      this.isRecording = false;
      // Clean up state on error
      await chrome.storage.local.remove(['recordingState']);

      // Show detailed error for debugging
      setTimeout(() => {
        alert(`Recording startup failed!\n\nError: ${error.message}\n\nStack: ${error.stack}`);
      }, 500);
    } finally {
      // Re-enable button
      startButton.disabled = false;
    }
  }

  async captureScreenshot() {
    // Only allow screenshot during recording
    if (!this.isRecording || !this.currentTest) {
      this.showNotification('Please start recording first to capture test screenshots', 'error');
      return;
    }

    try {
      this.showNotification('Capturing test screenshot...', 'info');
      console.log('Starting screenshot capture during recording...');

      // Get current active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      console.log('Current tab:', tab);

      if (!tab) {
        throw new Error('No active tab found');
      }

      // Check if tab URL is supported
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('moz-extension://') || tab.url.startsWith('edge://')) {
        throw new Error('Cannot capture screenshots of extension or system pages');
      }

      // Capture screenshot directly using chrome.tabs API
      console.log('Attempting to capture visible tab...');
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: 'png'
      });

      console.log('Screenshot captured, data URL length:', dataUrl?.length);

      if (!dataUrl) {
        throw new Error('No screenshot data received');
      }

      // Add screenshot as a test step
      const screenshotStep = {
        type: 'screenshot',
        timestamp: Date.now(),
        url: tab.url,
        screenshot: dataUrl,
        description: 'Visual checkpoint'
      };

      // Add to current test steps
      this.currentTest.steps.push(screenshotStep);

      // Also add to screenshots array for easy access
      if (!this.currentTest.screenshots) {
        this.currentTest.screenshots = [];
      }
      this.currentTest.screenshots.push(dataUrl);

      // Save current recording state
      await this.saveRecordingState();

      console.log('Screenshot added to test steps');

      // Show success notification
      this.showNotification('Screenshot captured and added to test!', 'success');

    } catch (error) {
      console.error('Screenshot capture failed:', error);
      this.showNotification(`Failed: ${error.message}`, 'error');
    }
  }

  async saveScreenshot(screenshot) {
    const result = await chrome.storage.local.get(['screenshots']);
    const screenshots = result.screenshots || [];
    screenshots.push(screenshot);

    // Keep only the last 50 screenshots to prevent storage overflow
    if (screenshots.length > 50) {
      screenshots.splice(0, screenshots.length - 50);
    }

    await chrome.storage.local.set({ screenshots });
  }

  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      padding: 10px 15px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      z-index: 10000;
      transition: all 0.3s ease;
      ${type === 'success' ? 'background: #10b981; color: white;' :
        type === 'error' ? 'background: #ef4444; color: white;' :
        'background: #3b82f6; color: white;'}
    `;
    notification.textContent = message;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.opacity = '0';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 2000);
  }

  async stopRecording() {
    if (!this.isRecording || !this.currentTest) return;

    try {
      this.isRecording = false;

      // Restore original browser size
      if (this.originalWindowSize) {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          await chrome.windows.update(tab.windowId, {
            width: this.originalWindowSize.width,
            height: this.originalWindowSize.height,
            left: this.originalWindowSize.left,
            top: this.originalWindowSize.top
          });
          this.showNotification('Browser size restored', 'info');
        } catch (restoreError) {
          console.error('Failed to restore window size:', restoreError);
          this.showNotification('Could not restore original size', 'info');
        }
        this.originalWindowSize = null;
      }

      await this.sendMessageToActiveTab({ action: 'stopRecording' });

      const result = await chrome.storage.local.get([`recording_${this.currentTest.name}`]);
      const contentScriptSteps = result[`recording_${this.currentTest.name}`] || [];

      // Merge content script steps with popup steps (like screenshots)
      // Sort all steps by timestamp to maintain proper order
      const allSteps = [...this.currentTest.steps, ...contentScriptSteps];
      allSteps.sort((a, b) => a.timestamp - b.timestamp);

      this.currentTest.steps = allSteps;
      this.tests.push(this.currentTest);
      await this.saveTests();

      await chrome.storage.local.remove([`recording_${this.currentTest.name}`]);

      this.currentTest = null;
      this.originalWindowSize = null;

      // Clear recording state from storage
      await chrome.storage.local.remove(['recordingState']);

      this.updateUI();

    } catch (error) {
      console.error('Error stopping recording:', error);
      this.showNotification('Error stopping recording', 'error');
    }
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
      this.showNotification('Starting test replay...', 'info');

      // Start replay FIRST
      await this.sendMessageToActiveTab({
        action: 'replayTest',
        test: test
      });

      this.showNotification('Replay started successfully!', 'success');

      // NOW resize browser after replay has started
      this.showNotification('Resizing browser for consistent replay...', 'info');

      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const window = await chrome.windows.get(tab.windowId);

        const originalSize = {
          width: window.width,
          height: window.height,
          left: window.left,
          top: window.top
        };

        // Resize to the same size used during recording
        const testSize = test.browserSize || { width: 1280, height: 720 };
        await chrome.windows.update(tab.windowId, {
          width: testSize.width,
          height: testSize.height + 80, // Add browser chrome height
          state: 'normal'
        });

        this.showNotification(`Browser resized to ${testSize.width}x${testSize.height}`, 'info');

        // Restore size after replay completes
        setTimeout(async () => {
          try {
            await chrome.windows.update(tab.windowId, {
              width: originalSize.width,
              height: originalSize.height,
              left: originalSize.left,
              top: originalSize.top
            });
            this.showNotification('Browser size restored after replay', 'info');
          } catch (restoreError) {
            console.error('Failed to restore window size:', restoreError);
          }
        }, test.steps.length * 1000 + 2000); // Estimate replay time + buffer

      } catch (resizeError) {
        console.error('Resize during replay failed:', resizeError);
        this.showNotification('Replay active, but resize failed', 'info');
        // Continue - replay is already running
      }

    } catch (error) {
      console.error('Replay failed:', error);
      this.showNotification('Failed to start replay', 'error');
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

  async sendMessageToActiveTab(message, timeout = 10000) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        throw new Error('No active tab found');
      }

      console.log('Active tab:', tab.url);

      // Check if the tab URL is supported
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('moz-extension://') || tab.url.startsWith('edge://')) {
        throw new Error('Extension pages are not supported');
      }

      // Add timeout to message sending
      const messagePromise = chrome.tabs.sendMessage(tab.id, message);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Message timeout')), timeout);
      });

      const result = await Promise.race([messagePromise, timeoutPromise]);
      console.log('Message result:', result);
      return result;
    } catch (error) {
      console.error('Failed to send message to tab:', error);
      throw error;
    }
  }

  updateUI() {
    const statusElement = document.getElementById('status');
    const startButton = document.getElementById('startRecording');
    const stopButton = document.getElementById('stopRecording');
    const screenshotButton = document.getElementById('captureScreenshot');
    const testListElement = document.getElementById('testList');
    const testNameInput = document.getElementById('testName');

    if (this.isRecording && this.currentTest) {
      statusElement.textContent = `Recording: ${this.currentTest.name}`;
      statusElement.className = 'status recording';
      startButton.disabled = true;
      stopButton.disabled = false;
      screenshotButton.disabled = false;
      screenshotButton.textContent = '📸 Capture Test Screenshot';
      testNameInput.disabled = true;
      testNameInput.value = this.currentTest.name;
    } else {
      statusElement.textContent = 'Ready to record';
      statusElement.className = 'status idle';
      startButton.disabled = false;
      stopButton.disabled = true;
      screenshotButton.disabled = true;
      screenshotButton.textContent = '📸 Start Recording First';
      testNameInput.disabled = false;
    }

    this.renderTestList(testListElement);
  }

  renderTestList(container) {
    if (this.tests.length === 0) {
      container.innerHTML = '<div class="empty-state">No tests recorded yet</div>';
      return;
    }

    container.innerHTML = this.tests.map((test, index) => {
      const screenshotSteps = test.steps.filter(step => step.type === 'screenshot' || step.screenshot);
      const screenshotCount = screenshotSteps.length;
      const screenshotsHtml = screenshotCount > 0 ? `
        <div class="test-screenshots">
          ${screenshotSteps.slice(0, 6).map((step, stepIndex) => `
            <img src="${step.screenshot}" class="screenshot-thumbnail"
                 data-test-index="${index}" data-step-index="${stepIndex}"
                 title="Step ${stepIndex + 1}: ${step.type}">
          `).join('')}
          ${screenshotCount > 6 ? `<div style="font-size: 10px; color: #6b7280;">+${screenshotCount - 6} more</div>` : ''}
        </div>
      ` : '';

      return `
        <div class="test-item">
          <div>
            <div class="test-name">${this.escapeHtml(test.name)}</div>
            <div style="font-size: 12px; color: #6b7280;">
              ${test.steps.length} steps • ${new Date(test.timestamp).toLocaleDateString()}
              ${screenshotCount > 0 ? ` • ${screenshotCount} screenshots` : ''}
            </div>
            ${screenshotsHtml}
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
      `;
    }).join('');

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

    // Add event listeners for screenshot thumbnails
    container.querySelectorAll('.screenshot-thumbnail').forEach(img => {
      img.addEventListener('click', (e) => {
        this.showScreenshotModal(e.target.src);
      });
    });
  }

  showScreenshotModal(imageSrc) {
    const modal = document.createElement('div');
    modal.className = 'screenshot-modal';
    modal.innerHTML = `<img src="${imageSrc}" alt="Screenshot">`;

    modal.addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    document.body.appendChild(modal);
  }

  async showScreenshotGallery() {
    const result = await chrome.storage.local.get(['screenshots']);
    const screenshots = result.screenshots || [];

    document.getElementById('testList').style.display = 'none';
    document.getElementById('screenshotGallery').style.display = 'block';

    this.renderScreenshotGallery(screenshots);
  }

  hideScreenshotGallery() {
    document.getElementById('testList').style.display = 'block';
    document.getElementById('screenshotGallery').style.display = 'none';
  }

  renderScreenshotGallery(screenshots) {
    const grid = document.getElementById('screenshotGrid');

    if (screenshots.length === 0) {
      grid.innerHTML = '<div class="empty-state">No screenshots captured yet</div>';
      return;
    }

    grid.innerHTML = screenshots.map((screenshot, index) => `
      <div style="position: relative;">
        <img src="${screenshot.dataUrl}" class="screenshot-thumbnail"
             data-screenshot-index="${index}"
             title="${screenshot.title} - ${new Date(screenshot.timestamp).toLocaleString()}">
        <div style="font-size: 10px; text-align: center; margin-top: 2px; color: #6b7280;">
          ${new Date(screenshot.timestamp).toLocaleTimeString()}
        </div>
        <button class="screenshot-delete" data-screenshot-index="${index}"
                style="position: absolute; top: 2px; right: 2px; background: #ef4444; color: white; border: none; border-radius: 50%; width: 16px; height: 16px; font-size: 10px; cursor: pointer;">×</button>
      </div>
    `).join('');

    // Add event listeners
    grid.querySelectorAll('.screenshot-thumbnail').forEach(img => {
      img.addEventListener('click', (e) => {
        const index = parseInt(e.target.getAttribute('data-screenshot-index'));
        this.showScreenshotModal(screenshots[index].dataUrl);
      });
    });

    grid.querySelectorAll('.screenshot-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const index = parseInt(e.target.getAttribute('data-screenshot-index'));
        await this.deleteScreenshot(index);
        this.showScreenshotGallery(); // Refresh gallery
      });
    });
  }

  async deleteScreenshot(index) {
    if (confirm('Delete this screenshot?')) {
      const result = await chrome.storage.local.get(['screenshots']);
      const screenshots = result.screenshots || [];
      screenshots.splice(index, 1);
      await chrome.storage.local.set({ screenshots });
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

const recorder = new E2ETestRecorder();