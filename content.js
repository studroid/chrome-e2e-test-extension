class E2EContentScript {
  constructor() {
    this.isRecording = false;
    this.isReplaying = false;
    this.currentTestName = null;
    this.recordedSteps = [];
    this.highlightedElement = null;
    this.overlay = null;
    this.init();
  }

  async init() {
    this.setupMessageListener();
    this.createOverlay();
    await this.checkRecordingState();
  }

  async checkRecordingState() {
    const result = await chrome.storage.local.get(['recordingState']);
    const state = result.recordingState;

    if (state && state.isRecording && state.currentTest) {
      this.isRecording = true;
      this.currentTestName = state.currentTest.name;
      this.recordedSteps = [];

      this.overlay.textContent = `Recording: ${this.currentTestName}`;
      this.overlay.style.display = 'block';
      this.overlay.style.background = '#dc2626';

      this.setupRecordingListeners();
    }
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      switch (message.action) {
        case 'startRecording':
          this.startRecording(message.testName);
          break;
        case 'stopRecording':
          this.stopRecording();
          break;
        case 'replayTest':
          this.replayTest(message.test);
          break;
      }
      sendResponse({ success: true });
    });
  }

  createOverlay() {
    this.overlay = document.createElement('div');
    this.overlay.id = 'e2e-recorder-overlay';
    this.overlay.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: #1f2937;
      color: white;
      padding: 10px 15px;
      border-radius: 6px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      z-index: 10000;
      display: none;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    `;
    document.body.appendChild(this.overlay);
  }

  startRecording(testName) {
    this.isRecording = true;
    this.currentTestName = testName;
    this.recordedSteps = [];

    this.overlay.textContent = `Recording: ${testName}`;
    this.overlay.style.display = 'block';
    this.overlay.style.background = '#dc2626';

    this.setupRecordingListeners();
  }

  stopRecording() {
    this.isRecording = false;
    this.overlay.style.display = 'none';
    this.removeRecordingListeners();
    this.saveRecordedSteps();
    this.clearHighlight();
  }

  setupRecordingListeners() {
    document.addEventListener('click', this.handleClick, true);
    document.addEventListener('input', this.handleInput, true);
    document.addEventListener('change', this.handleChange, true);
    document.addEventListener('mouseover', this.handleMouseOver, true);
    document.addEventListener('mouseout', this.handleMouseOut, true);
    document.addEventListener('keydown', this.handleKeyDown, true);
  }

  removeRecordingListeners() {
    document.removeEventListener('click', this.handleClick, true);
    document.removeEventListener('input', this.handleInput, true);
    document.removeEventListener('change', this.handleChange, true);
    document.removeEventListener('mouseover', this.handleMouseOver, true);
    document.removeEventListener('mouseout', this.handleMouseOut, true);
    document.removeEventListener('keydown', this.handleKeyDown, true);
  }

  handleClick = (event) => {
    if (!this.isRecording) return;

    event.preventDefault();
    event.stopPropagation();

    const element = event.target;
    const selector = this.generateSelector(element);

    this.recordStep({
      type: 'click',
      selector: selector,
      text: element.textContent?.trim() || '',
      timestamp: Date.now(),
      url: window.location.href
    });

    this.showTemporaryHighlight(element, 'Click recorded');
  }

  handleInput = (event) => {
    if (!this.isRecording) return;

    const element = event.target;
    const selector = this.generateSelector(element);

    this.recordStep({
      type: 'input',
      selector: selector,
      value: element.value,
      timestamp: Date.now(),
      url: window.location.href
    });
  }

  handleChange = (event) => {
    if (!this.isRecording) return;

    const element = event.target;
    if (element.type === 'checkbox' || element.type === 'radio' || element.tagName === 'SELECT') {
      const selector = this.generateSelector(element);

      this.recordStep({
        type: 'change',
        selector: selector,
        value: element.type === 'checkbox' ? element.checked : element.value,
        timestamp: Date.now(),
        url: window.location.href
      });
    }
  }

  handleKeyDown = (event) => {
    if (!this.isRecording) return;

    if (event.key === 'Enter' || event.key === 'Tab') {
      const element = event.target;
      const selector = this.generateSelector(element);

      this.recordStep({
        type: 'keypress',
        selector: selector,
        key: event.key,
        timestamp: Date.now(),
        url: window.location.href
      });
    }
  }

  handleMouseOver = (event) => {
    if (!this.isRecording) return;
    this.highlightElement(event.target);
  }

  handleMouseOut = (event) => {
    if (!this.isRecording) return;
    this.clearHighlight();
  }

  highlightElement(element) {
    this.clearHighlight();
    element.style.outline = '2px solid #3b82f6';
    element.style.outlineOffset = '1px';
    this.highlightedElement = element;
  }

  clearHighlight() {
    if (this.highlightedElement) {
      this.highlightedElement.style.outline = '';
      this.highlightedElement.style.outlineOffset = '';
      this.highlightedElement = null;
    }
  }

  showTemporaryHighlight(element, message) {
    element.style.outline = '2px solid #10b981';
    element.style.outlineOffset = '1px';

    const tooltip = document.createElement('div');
    tooltip.textContent = message;
    tooltip.style.cssText = `
      position: absolute;
      background: #10b981;
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      z-index: 10001;
      pointer-events: none;
    `;

    const rect = element.getBoundingClientRect();
    tooltip.style.left = (rect.left + window.scrollX) + 'px';
    tooltip.style.top = (rect.top + window.scrollY - 30) + 'px';

    document.body.appendChild(tooltip);

    setTimeout(() => {
      element.style.outline = '';
      element.style.outlineOffset = '';
      if (tooltip.parentNode) {
        tooltip.parentNode.removeChild(tooltip);
      }
    }, 1000);
  }

  generateSelector(element) {
    if (element.id) {
      return `#${element.id}`;
    }

    if (element.className) {
      const classes = element.className.split(' ').filter(c => c.trim());
      if (classes.length > 0) {
        const selector = `.${classes.join('.')}`;
        if (document.querySelectorAll(selector).length === 1) {
          return selector;
        }
      }
    }

    if (element.getAttribute('data-testid')) {
      return `[data-testid="${element.getAttribute('data-testid')}"]`;
    }

    if (element.name) {
      return `[name="${element.name}"]`;
    }

    let path = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let selector = current.nodeName.toLowerCase();

      if (current.id) {
        selector += `#${current.id}`;
        path.unshift(selector);
        break;
      }

      let sibling = current;
      let nth = 1;
      while (sibling = sibling.previousElementSibling) {
        if (sibling.nodeName.toLowerCase() === selector) {
          nth++;
        }
      }

      if (nth > 1) {
        selector += `:nth-of-type(${nth})`;
      }

      path.unshift(selector);
      current = current.parentNode;
    }

    return path.join(' > ');
  }

  recordStep(step) {
    this.recordedSteps.push(step);
    console.log('Step recorded:', step);
  }

  async saveRecordedSteps() {
    await chrome.storage.local.set({
      [`recording_${this.currentTestName}`]: this.recordedSteps
    });
  }

  async replayTest(test) {
    if (this.isReplaying) return;

    this.isReplaying = true;
    this.overlay.textContent = `Replaying: ${test.name}`;
    this.overlay.style.display = 'block';
    this.overlay.style.background = '#1d4ed8';

    try {
      for (let i = 0; i < test.steps.length; i++) {
        const step = test.steps[i];
        await this.executeStep(step, i + 1, test.steps.length);
        await this.delay(500);
      }

      this.overlay.textContent = `✓ Replay completed: ${test.name}`;
      this.overlay.style.background = '#10b981';

      setTimeout(() => {
        this.overlay.style.display = 'none';
      }, 2000);

    } catch (error) {
      console.error('Replay failed:', error);
      this.overlay.textContent = `✗ Replay failed: ${error.message}`;
      this.overlay.style.background = '#dc2626';

      setTimeout(() => {
        this.overlay.style.display = 'none';
      }, 3000);
    }

    this.isReplaying = false;
  }

  async executeStep(step, currentStep, totalSteps) {
    this.overlay.textContent = `Replaying: ${currentStep}/${totalSteps}`;

    const element = document.querySelector(step.selector);
    if (!element) {
      throw new Error(`Element not found: ${step.selector}`);
    }

    this.highlightElement(element);
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await this.delay(300);

    switch (step.type) {
      case 'click':
        element.click();
        break;
      case 'input':
        element.focus();
        element.value = step.value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        break;
      case 'change':
        if (element.type === 'checkbox' || element.type === 'radio') {
          element.checked = step.value;
        } else {
          element.value = step.value;
        }
        element.dispatchEvent(new Event('change', { bubbles: true }));
        break;
      case 'keypress':
        element.focus();
        element.dispatchEvent(new KeyboardEvent('keydown', { key: step.key, bubbles: true }));
        break;
    }

    this.clearHighlight();
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', async () => {
    new E2EContentScript();
  });
} else {
  new E2EContentScript();
}