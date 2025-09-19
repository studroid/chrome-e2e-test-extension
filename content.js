// Prevent multiple instances
if (typeof window.E2EContentScript !== 'undefined') {
  console.log('E2E Content Script already loaded, skipping...');
} else {

class E2EContentScript {
  constructor() {
    this.isRecording = false;
    this.isReplaying = false;
    this.currentTestName = null;
    this.recordedSteps = [];
    this.highlightedElement = null;
    this.overlay = null;
    this.isTestInterrupted = false; // Flag to interrupt test execution
    this.settings = {
      recordingDelay: 100,
      replayDelay: 300
    };
    this.init();
  }

  async init() {
    this.setupMessageListener();
    this.createOverlay();
    await this.loadSettings();
    await this.checkRecordingState();

    // Check for pending test execution after a short delay
    setTimeout(() => {
      this.checkPendingTestExecution();
    }, 1500);
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.local.get(['settings']);
      if (result.settings) {
        this.settings = { ...this.settings, ...result.settings };
      }
    } catch (error) {
      console.log('Could not load settings, using defaults:', error);
    }
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

  async checkPendingTestExecution() {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'getTestExecutionState'
      });

      if (response && response.state) {
        console.log('🔍 Found pending test execution state, resuming test...');
        await this.resumeTest(response.state);
      }
    } catch (error) {
      // Content script might not be ready or no pending test
      console.log('No pending test execution found or content script not ready');
    }
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      switch (message.action) {
        case 'ping':
          // Simple ping to verify content script is alive and responsive
          sendResponse({ success: true, message: 'Content script is ready' });
          break;
        case 'getReplayStatus':
          // Check current replay status
          const isMatching = message.executionId ?
            (this.currentExecutionId === message.executionId) : true;
          sendResponse({
            success: true,
            isReplaying: this.isReplaying && isMatching,
            currentExecutionId: this.currentExecutionId,
            isTestInterrupted: this.isTestInterrupted
          });
          break;
        case 'forceReset':
          // Emergency force reset
          console.log('🚨 Received force reset command');
          this.forceResetReplayState();
          sendResponse({ success: true, message: 'State forcefully reset' });
          break;
        case 'forceStopTest':
          // Force stop specific test
          console.log(`🛑 Received force stop command for execution ID: ${message.executionId}`);
          this.forceStopTest(message.executionId);
          sendResponse({ success: true, message: 'Test forcefully stopped' });
          break;
        case 'startRecording':
          this.startRecording(message.testName);
          break;
        case 'stopRecording':
          this.stopRecording();
          break;
        case 'replayTest':
          this.replayTest(message.test, message.executionId);
          break;
        case 'resumeTest':
          this.resumeTest(message.executionState);
          break;
        case 'captureFullPageScreenshot':
          this.captureFullPageScreenshot()
            .then(screenshot => sendResponse({ screenshot }))
            .catch(error => sendResponse({ error: error.message }));
          return true; // Keep message channel open for async response
        case 'getCurrentScrollPosition':
          // 다양한 스크롤 위치 가져오기 방법 시도
          const scrollX = window.pageXOffset ||
                          document.documentElement.scrollLeft ||
                          document.body.scrollLeft ||
                          0;
          const scrollY = window.pageYOffset ||
                          document.documentElement.scrollTop ||
                          document.body.scrollTop ||
                          0;

          console.log('Scroll position check:', {
            windowScrollX: window.scrollX,
            windowScrollY: window.scrollY,
            pageXOffset: window.pageXOffset,
            pageYOffset: window.pageYOffset,
            documentScrollTop: document.documentElement.scrollTop,
            bodyScrollTop: document.body.scrollTop,
            finalX: scrollX,
            finalY: scrollY
          });

          sendResponse({
            success: true,
            scrollPosition: {
              x: scrollX,
              y: scrollY
            }
          });
          return;
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
    this.startUrl = window.location.href; // Save starting URL

    this.overlay.textContent = `Recording: ${testName}`;
    this.overlay.style.display = 'block';
    this.overlay.style.background = '#dc2626';

    console.log(`📝 Started recording "${testName}" from URL: ${this.startUrl}`);

    // Record the initial page as the first step
    this.recordStep({
      type: 'navigation',
      action: 'start',
      toUrl: this.startUrl,
      timestamp: Date.now(),
      isInitialStep: true
    });

    this.setupRecordingListeners();
  }

  async captureFullPageScreenshot() {
    try {
      // Hide all indicators and progress overlays before taking screenshot
      this.hideAllIndicators();
      this.hideScreenshotProgress();
      await this.delay(100); // Brief delay to ensure everything is hidden

      // Simply capture the current viewport for now
      const screenshot = await this.captureScreenshot();

      if (!screenshot) {
        throw new Error('Failed to capture viewport screenshot');
      }

      return screenshot;

    } catch (error) {
      this.hideScreenshotProgress();
      console.error('Screenshot capture error:', error);
      throw error;
    }
  }

  drawImageOnCanvas(ctx, imageDataUrl, x, y) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, x, y);
        resolve();
      };
      img.src = imageDataUrl;
    });
  }

  showScreenshotProgress(message) {
    if (!this.progressOverlay) {
      this.progressOverlay = document.createElement('div');
      this.progressOverlay.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 20px 30px;
        border-radius: 8px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 16px;
        z-index: 2147483647;
        text-align: center;
      `;
      document.body.appendChild(this.progressOverlay);
    }
    this.progressOverlay.textContent = message;
    this.progressOverlay.style.display = 'block';
  }

  updateScreenshotProgress(message) {
    if (this.progressOverlay) {
      this.progressOverlay.textContent = message;
    }
  }

  hideScreenshotProgress() {
    if (this.progressOverlay) {
      this.progressOverlay.style.display = 'none';
    }
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

    // Navigation detection
    window.addEventListener('beforeunload', this.handleBeforeUnload, true);
    window.addEventListener('load', this.handlePageLoad, true);
  }

  removeRecordingListeners() {
    document.removeEventListener('click', this.handleClick, true);
    document.removeEventListener('input', this.handleInput, true);
    document.removeEventListener('change', this.handleChange, true);
    document.removeEventListener('mouseover', this.handleMouseOver, true);
    document.removeEventListener('mouseout', this.handleMouseOut, true);
    document.removeEventListener('keydown', this.handleKeyDown, true);

    // Navigation cleanup
    window.removeEventListener('beforeunload', this.handleBeforeUnload, true);
    window.removeEventListener('load', this.handlePageLoad, true);
  }

  handleClick = async (event) => {
    if (!this.isRecording) return;

    event.preventDefault();
    event.stopPropagation();

    const element = event.target;
    const selector = this.generateSelector(element);

    // Store current scroll position before scrolling
    const originalScrollX = window.scrollX;
    const originalScrollY = window.scrollY;

    // Scroll element into view for better visibility (same as replay behavior)
    element.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'center'
    });

    // Wait a moment for scroll to complete
    await this.delay(this.settings.recordingDelay);

    // Get new scroll position after scrolling
    const newScrollX = window.scrollX;
    const newScrollY = window.scrollY;

    this.recordStep({
      type: 'click',
      selector: selector,
      text: element.textContent?.trim() || '',
      timestamp: Date.now(),
      url: window.location.href,
      scrollPosition: {
        before: { x: originalScrollX, y: originalScrollY },
        after: { x: newScrollX, y: newScrollY }
      }
    });

    this.showTemporaryHighlight(element, 'Click recorded + scrolled');
  }

  handleInput = async (event) => {
    if (!this.isRecording) return;

    const element = event.target;
    const selector = this.generateSelector(element);

    // Scroll input element into view for better visibility
    element.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'center'
    });

    this.recordStep({
      type: 'input',
      selector: selector,
      value: element.value,
      timestamp: Date.now(),
      url: window.location.href,
      scrollPosition: {
        x: window.scrollX,
        y: window.scrollY
      }
    });
  }

  handleChange = async (event) => {
    if (!this.isRecording) return;

    const element = event.target;
    if (element.type === 'checkbox' || element.type === 'radio' || element.tagName === 'SELECT') {
      const selector = this.generateSelector(element);

      // Scroll element into view for better visibility
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'center'
      });

      await this.delay(this.settings.recordingDelay); // Short delay for scroll

      this.recordStep({
        type: 'change',
        selector: selector,
        value: element.type === 'checkbox' ? element.checked : element.value,
        timestamp: Date.now(),
        url: window.location.href,
        scrollPosition: {
          x: window.scrollX,
          y: window.scrollY
        }
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

  handleBeforeUnload = (event) => {
    if (!this.isRecording) return;

    // Record navigation step before page unloads
    this.recordStep({
      type: 'navigation',
      action: 'leaving',
      fromUrl: window.location.href,
      timestamp: Date.now()
    });

    // Save recorded steps before navigation
    this.saveRecordedSteps();
  }

  handlePageLoad = (event) => {
    if (!this.isRecording) return;

    // Record navigation step after page loads
    this.recordStep({
      type: 'navigation',
      action: 'arrived',
      toUrl: window.location.href,
      timestamp: Date.now()
    });
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

  showScreenshotIndicator(message, duration = 1000) {
    // Create a full-screen overlay for screenshot indication
    const indicator = document.createElement('div');
    indicator.textContent = message;

    // Different colors for different message types
    let backgroundColor = '#3b82f6'; // Default blue
    let borderColor = '#60a5fa';

    if (message.includes('❌') || message.includes('Failed')) {
      backgroundColor = '#dc2626'; // Red for errors
      borderColor = '#f87171';
    } else if (message.includes('✓')) {
      backgroundColor = '#10b981'; // Green for success
      borderColor = '#34d399';
    } else if (message.includes('⚠️')) {
      backgroundColor = '#f59e0b'; // Orange for warnings
      borderColor = '#fbbf24';
    }

    indicator.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: ${backgroundColor};
      color: white;
      padding: 15px 25px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 16px;
      font-weight: 500;
      z-index: 10002;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
      border: 2px solid ${borderColor};
      max-width: 80%;
      text-align: center;
    `;

    document.body.appendChild(indicator);

    // Remove after delay
    setTimeout(() => {
      if (indicator.parentNode) {
        indicator.parentNode.removeChild(indicator);
      }
    }, duration);
  }

  hideAllIndicators() {
    // Remove all existing screenshot indicators to prevent them from appearing in screenshots
    const indicators = document.querySelectorAll('[style*="z-index: 10002"]');
    indicators.forEach(indicator => {
      if (indicator.parentNode) {
        indicator.parentNode.removeChild(indicator);
      }
    });

    // Also hide screenshot progress overlay
    this.hideScreenshotProgress();

    // Remove any other high z-index overlays that might interfere
    const highZIndexElements = document.querySelectorAll('[style*="z-index: 2147483647"]');
    highZIndexElements.forEach(element => {
      if (element.parentNode && element !== this.overlay) {
        element.style.display = 'none';
      }
    });
  }

  async updateBaselineScreenshot(step, newScreenshot, stepNumber) {
    try {
      console.log(`Updating baseline screenshot for step ${stepNumber}...`);

      // Update the step's screenshot with the new one
      step.screenshot = newScreenshot;

      // Send the updated step back to popup for storage
      await chrome.runtime.sendMessage({
        action: 'updateStepScreenshot',
        stepNumber: stepNumber,
        newScreenshot: newScreenshot,
        stepData: step
      });

      console.log(`Baseline screenshot updated successfully for step ${stepNumber}`);
    } catch (error) {
      console.error('Failed to update baseline screenshot:', error);
      throw error;
    }
  }

  // Helper function to escape CSS special characters
  escapeCssIdentifier(identifier) {
    // Escape all CSS special characters for Tailwind and other frameworks
    return identifier.replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g, '\\$&');
  }

  // Test function for problematic selectors (for debugging)
  testProblematicSelectors() {
    console.log('🧪 Testing improved selector generation...');

    const testCases = [
      'ab-list-item-child list-item-child before:truncate before:max-w-[100%] slate-list-item-child',
      'slate-editor ignore-click-outside/toolbar',
      'flex flex-col xl:flex-1 md:items-center'
    ];

    testCases.forEach((testClass, index) => {
      console.log(`Test ${index + 1}: "${testClass}"`);
      try {
        const escaped = this.escapeCssIdentifier(testClass);
        console.log(`  Escaped: "${escaped}"`);
        const selector = `.${escaped}`;
        const isValid = this.isValidSelector(selector);
        console.log(`  Valid: ${isValid}`);
      } catch (error) {
        console.error(`  Error: ${error.message}`);
      }
    });
  }

  // Helper function to validate CSS selector
  isValidSelector(selector) {
    try {
      document.querySelector(selector);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Helper function to check if selector is unique
  isUniqueSelector(selector) {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch (e) {
      return false;
    }
  }

  generateSelector(element) {
    // Priority 1: ID (highest priority)
    if (element.id) {
      const idSelector = `#${this.escapeCssIdentifier(element.id)}`;
      if (this.isValidSelector(idSelector) && this.isUniqueSelector(idSelector)) {
        return idSelector;
      }
    }

    // Priority 2: data-testid (very stable)
    if (element.getAttribute('data-testid')) {
      const testIdSelector = `[data-testid="${element.getAttribute('data-testid')}"]`;
      if (this.isValidSelector(testIdSelector) && this.isUniqueSelector(testIdSelector)) {
        return testIdSelector;
      }
    }

    // Priority 3: name attribute (stable for form elements)
    if (element.name) {
      const nameSelector = `[name="${element.name}"]`;
      if (this.isValidSelector(nameSelector) && this.isUniqueSelector(nameSelector)) {
        return nameSelector;
      }
    }

    // Priority 4: Try other stable attributes
    const stableAttributes = ['data-cy', 'data-test', 'aria-label', 'role'];
    for (const attr of stableAttributes) {
      const value = element.getAttribute(attr);
      if (value) {
        const attrSelector = `[${attr}="${value}"]`;
        if (this.isValidSelector(attrSelector) && this.isUniqueSelector(attrSelector)) {
          return attrSelector;
        }
      }
    }

    // Priority 5: Class names (with improved escaping)
    if (element.className) {
      const classes = element.className.split(' ')
        .filter(c => c.trim())
        .map(c => this.escapeCssIdentifier(c));

      if (classes.length > 0) {
        // Try all classes first
        let classSelector = `.${classes.join('.')}`;
        if (this.isValidSelector(classSelector) && this.isUniqueSelector(classSelector)) {
          return classSelector;
        }

        // Try combinations of classes if full selector doesn't work
        for (let i = Math.min(3, classes.length); i > 0; i--) {
          for (let j = 0; j <= classes.length - i; j++) {
            const selectedClasses = classes.slice(j, j + i);
            classSelector = `.${selectedClasses.join('.')}`;
            if (this.isValidSelector(classSelector) && this.isUniqueSelector(classSelector)) {
              return classSelector;
            }
          }
        }
      }
    }

    // Priority 6: Tag with attributes combination
    const tagName = element.tagName.toLowerCase();
    const text = element.textContent?.trim();
    if (text && text.length < 50) {
      const textSelector = `${tagName}:contains("${text.replace(/"/g, '\\"')}")`;
      if (this.isValidSelector(textSelector) && this.isUniqueSelector(textSelector)) {
        return textSelector;
      }
    }

    // Priority 7: Generate parent-based selector (but limit depth)
    return this.generateParentBasedSelector(element, 5);
  }

  // Enhanced element finding with retry and waiting mechanisms
  async findElementWithRetry(selector, options = {}) {
    const {
      maxAttempts = 5,
      waitBetweenAttempts = 1000,
      waitForElement = true,
      timeout = 10000,
      expectedText = null
    } = options;

    console.log(`🔎 Searching for element: "${selector}" (max attempts: ${maxAttempts})`);

    // First validate the selector
    if (!this.isValidSelector(selector)) {
      console.error(`❌ Invalid selector: "${selector}"`);
      await this.debugSelector(selector);
      return null;
    }

    let attempt = 0;
    const startTime = Date.now();

    while (attempt < maxAttempts && (Date.now() - startTime) < timeout) {
      attempt++;

      try {
        console.log(`🔄 Attempt ${attempt}/${maxAttempts} for selector: "${selector}"`);

        // Try to find the element(s)
        let elements = document.querySelectorAll(selector);
        let element = null;

        if (elements.length > 0) {
          console.log(`🔍 Found ${elements.length} element(s) matching selector`);

          // If expectedText is provided, filter by text content
          if (expectedText && expectedText.trim()) {
            console.log(`🔍 Filtering by expected text: "${expectedText}"`);

            for (const el of elements) {
              const elementText = el.textContent?.trim() || '';
              if (elementText === expectedText) {
                element = el;
                console.log(`✅ Found element with matching text content`);
                break;
              }
            }

            if (!element) {
              console.log(`❌ No element found with matching text content. Found texts:`);
              for (let i = 0; i < Math.min(elements.length, 3); i++) {
                const el = elements[i];
                const text = (el.textContent?.trim() || '').substring(0, 100);
                console.log(`  [${i}]: "${text}${text.length >= 100 ? '...' : ''}"`);
              }
            }
          } else {
            // No text filtering, use first element
            element = elements[0];
            if (elements.length > 1) {
              console.log(`⚠️ Multiple elements found, using first one (consider adding text content for better targeting)`);
            }
          }

          if (element) {
            console.log(`✅ Element selected on attempt ${attempt}`);

            // If waitForElement is true, also check if element is visible and interactable
            if (waitForElement) {
              const isVisible = await this.waitForElementToBeVisible(element);
              if (isVisible) {
                return element;
              } else {
                console.log(`⏳ Element found but not visible yet, waiting...`);
              }
            } else {
              return element;
            }
          }
        } else {
          console.log(`❌ No elements found with selector on attempt ${attempt}`);
        }

        // Wait before next attempt (except for last attempt)
        if (attempt < maxAttempts) {
          console.log(`⏳ Waiting ${waitBetweenAttempts}ms before next attempt...`);
          await this.delay(waitBetweenAttempts);
        }

      } catch (error) {
        console.error(`❌ Error during attempt ${attempt}:`, error);
        if (attempt === maxAttempts) {
          await this.debugSelector(selector);
          return null;
        }
      }
    }

    console.error(`❌ Element not found after ${maxAttempts} attempts: "${selector}"`);
    await this.debugSelector(selector);
    return null;
  }

  async waitForElementToBeVisible(element, timeout = 5000) {
    const startTime = Date.now();

    while ((Date.now() - startTime) < timeout) {
      const rect = element.getBoundingClientRect();
      const isVisible = rect.width > 0 && rect.height > 0 &&
                       window.getComputedStyle(element).visibility !== 'hidden' &&
                       window.getComputedStyle(element).display !== 'none';

      if (isVisible) {
        return true;
      }

      await this.delay(100);
    }

    return false;
  }


  async debugSelector(selector) {
    console.log('🔍 Debugging selector:', selector);

    try {
      // Check if selector contains ID
      const idMatch = selector.match(/#([^.\s>]+)/);
      if (idMatch) {
        const id = idMatch[1];
        console.log(`Looking for element with id="${id}"...`);
        const elementById = document.getElementById(id);
        console.log(`Element with id="${id}" ${elementById ? 'EXISTS' : 'NOT FOUND'}`);
      }

      // Check if selector contains class
      const classMatches = selector.match(/\.([^.\s>#\[\]:]+)/g);
      if (classMatches) {
        classMatches.forEach(match => {
          const className = match.substring(1); // Remove the dot
          console.log(`Looking for elements with class="${className}"...`);
          const elementsByClass = document.getElementsByClassName(className);
          console.log(`Found ${elementsByClass.length} elements with class="${className}"`);
        });
      }

      // Try to find similar elements for debugging
      const tagMatch = selector.match(/^([a-zA-Z]+)/);
      if (tagMatch) {
        const tagName = tagMatch[1];
        const similarElements = document.querySelectorAll(tagName);
        console.log(`Found ${similarElements.length} <${tagName}> elements on page`);
        similarElements.forEach((el, index) => {
          if (index < 5) { // Show first 5
            console.log(`  ${index + 1}. ${el.tagName} - id: ${el.id || 'none'} - class: ${el.className || 'none'}`);
          }
        });
      }
    } catch (debugError) {
      console.warn('Debug analysis failed:', debugError);
    }
  }

  generateParentBasedSelector(element, maxDepth = 5) {
    let path = [];
    let current = element;
    let depth = 0;

    while (current && current.nodeType === Node.ELEMENT_NODE && depth < maxDepth) {
      let selector = current.nodeName.toLowerCase();

      // Try to use ID if available
      if (current.id) {
        const idPart = this.escapeCssIdentifier(current.id);
        selector += `#${idPart}`;
        path.unshift(selector);
        break;
      }

      // Try to use a distinguishing class
      if (current.className) {
        const classes = current.className.split(' ')
          .filter(c => c.trim())
          .map(c => this.escapeCssIdentifier(c));

        // Use first few classes to make selector more specific but not too fragile
        if (classes.length > 0) {
          const useClasses = classes.slice(0, Math.min(2, classes.length));
          selector += `.${useClasses.join('.')}`;
        }
      }

      // Only use nth-child for very specific cases and avoid high numbers
      let sibling = current;
      let nth = 1;
      while (sibling = sibling.previousElementSibling) {
        if (sibling.nodeName.toLowerCase() === current.nodeName.toLowerCase()) {
          nth++;
        }
      }

      // Only add nth-child if it's a reasonable number and would be stable
      if (nth > 1 && nth <= 10) {
        selector += `:nth-child(${nth})`;
      }

      path.unshift(selector);
      current = current.parentNode;
      depth++;
    }

    const fullSelector = path.join(' > ');

    // Validate the generated selector
    if (!this.isValidSelector(fullSelector)) {
      console.warn('Generated invalid selector, falling back to simple tag selector:', fullSelector);
      return element.tagName.toLowerCase();
    }

    return fullSelector;
  }

  showTestResult(success, testName, totalSteps, errorMessage, duration = null) {
    const resultModal = document.createElement('div');
    resultModal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 10004;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      background: white;
      padding: 30px;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      text-align: center;
      min-width: 400px;
      max-width: 500px;
    `;

    const currentTime = new Date().toLocaleTimeString();
    const icon = success ? '✅' : '❌';
    const status = success ? 'PASSED' : 'FAILED';
    const color = success ? '#10b981' : '#dc2626';

    modal.innerHTML = `
      <div style="font-size: 48px; margin-bottom: 20px;">${icon}</div>
      <h2 style="margin: 0 0 10px 0; color: ${color}; font-size: 24px;">Test ${status}</h2>
      <div style="font-size: 18px; color: #374151; margin-bottom: 20px; font-weight: 500;">${testName}</div>

      <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
        <div style="display: grid; grid-template-columns: 1fr 1fr${duration ? ' 1fr' : ''}; gap: 15px; text-align: left;">
          <div>
            <div style="font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px;">Total Steps</div>
            <div style="font-size: 18px; font-weight: 600; color: #1f2937;">${totalSteps}</div>
          </div>
          <div>
            <div style="font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px;">Completed</div>
            <div style="font-size: 18px; font-weight: 600; color: #1f2937;">${currentTime}</div>
          </div>
          ${duration ? `
          <div>
            <div style="font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px;">Duration</div>
            <div style="font-size: 18px; font-weight: 600; color: #1f2937;">${(duration / 1000).toFixed(1)}s</div>
          </div>
          ` : ''}
        </div>

        ${!success ? `
        <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #e5e7eb;">
          <div style="font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px;">Error</div>
          <div style="font-size: 14px; color: #dc2626; background: #fef2f2; padding: 10px; border-radius: 6px; word-break: break-word;">${errorMessage}</div>
        </div>
        ` : ''}
      </div>

      <button id="close-result-modal" style="
        background: ${color};
        color: white;
        border: none;
        padding: 12px 30px;
        border-radius: 8px;
        font-size: 16px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
      ">Close</button>
    `;

    resultModal.appendChild(modal);
    document.body.appendChild(resultModal);

    // Close button event
    document.getElementById('close-result-modal').addEventListener('click', () => {
      document.body.removeChild(resultModal);
    });

    // Click outside to close
    resultModal.addEventListener('click', (e) => {
      if (e.target === resultModal) {
        document.body.removeChild(resultModal);
      }
    });

    // Auto-close after delay (longer for failures)
    setTimeout(() => {
      if (resultModal.parentNode) {
        document.body.removeChild(resultModal);
      }
    }, success ? 4000 : 8000);
  }

  // Test method to verify Tailwind CSS selector escaping
  testTailwindSelectorEscaping() {
    const testClasses = [
      'flex flex-col xl:flex-1 md:items-center',
      'sm:text-xl lg:text-2xl hover:bg-blue-500',
      'md:w-1/2 lg:w-1/3 xl:w-1/4'
    ];

    console.log('🧪 Testing Tailwind CSS selector escaping:');
    testClasses.forEach(className => {
      const escaped = className.split(' ')
        .filter(c => c.trim())
        .map(c => c.replace(/:/g, '\\:'))
        .join('.');

      const selector = `.${escaped}`;
      console.log(`Original: "${className}"`);
      console.log(`Escaped: "${selector}"`);

      try {
        document.querySelector(selector);
        console.log('✅ Valid selector');
      } catch (e) {
        console.log('❌ Invalid selector:', e.message);
      }
      console.log('---');
    });
  }

  recordStep(step) {
    this.recordedSteps.push(step);
    console.log('Step recorded:', step);
  }

  async captureScreenshot() {
    return new Promise(async (resolve, reject) => {
      console.log('Starting captureScreenshot...');

      // Set timeout to prevent infinite waiting
      const timeout = setTimeout(() => {
        console.error('Screenshot capture timed out after 10 seconds');
        reject(new Error('Screenshot capture timed out'));
      }, 10000);

      try {
        console.log('Sending message to background script...');
        const response = await chrome.runtime.sendMessage({
          action: 'captureScreenshot'
        });

        console.log('Background script response:', response);
        clearTimeout(timeout);

        if (response && response.dataUrl) {
          console.log('Screenshot captured successfully, data URL length:', response.dataUrl.length);
          resolve(response.dataUrl);
        } else if (response && response.error) {
          reject(new Error(`Background script error: ${response.error}`));
        } else {
          reject(new Error('No dataUrl in response'));
        }
      } catch (error) {
        console.error('Screenshot capture failed:', error);
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  async captureElementScreenshot(element, scrollPosition = null) {
    try {
      if (scrollPosition) {
        // Use saved scroll position for exact positioning
        console.log(`📍 Restoring scroll position: x=${scrollPosition.x}, y=${scrollPosition.y}`);
        // 다양한 방법으로 스크롤 시도
        window.scrollTo(scrollPosition.x, scrollPosition.y);
        document.documentElement.scrollTop = scrollPosition.y;
        document.documentElement.scrollLeft = scrollPosition.x;
        document.body.scrollTop = scrollPosition.y;
        document.body.scrollLeft = scrollPosition.x;
        await this.delay(300); // Wait longer for scroll to complete
      } else {
        // Fallback to original behavior
        element.scrollIntoView({ behavior: 'auto', block: 'center' });
        await this.delay(100);
      }

      // Hide all indicators before taking screenshot to avoid interference
      this.hideAllIndicators();
      await this.delay(100);

      const rect = element.getBoundingClientRect();
      const screenshot = await this.captureScreenshot();

      if (!screenshot) return null;

      // Crop the screenshot to the element bounds
      return await this.cropScreenshot(screenshot, rect);
    } catch (error) {
      console.error('Element screenshot capture failed:', error);
      return null;
    }
  }

  async cropScreenshot(screenshotDataUrl, rect) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Set canvas size to element size
        canvas.width = rect.width;
        canvas.height = rect.height;

        // Draw the cropped portion
        ctx.drawImage(
          img,
          rect.left, rect.top, rect.width, rect.height,
          0, 0, rect.width, rect.height
        );

        resolve(canvas.toDataURL('image/png'));
      };
      img.src = screenshotDataUrl;
    });
  }

  async saveRecordedSteps() {
    const testData = {
      name: this.currentTestName,
      startUrl: this.startUrl,
      steps: this.recordedSteps,
      createdAt: new Date().toISOString()
    };

    console.log(`💾 Saving test "${this.currentTestName}" with start URL: ${this.startUrl}`);

    await chrome.storage.local.set({
      [`recording_${this.currentTestName}`]: testData
    });
  }

  async replayTest(test, executionId = null) {
    if (this.isReplaying) {
      console.warn('⚠️ Test already in progress, ignoring duplicate request');
      return;
    }

    console.log(`🎬 Starting test replay: "${test.name}" (ID: ${executionId})`);

    // Clear any previous interruption flag
    this.isTestInterrupted = false;

    // Store execution ID for message tracking
    this.currentExecutionId = executionId;

    // Set replaying state with timeout protection
    this.isReplaying = true;
    this.currentReplayTimeout = setTimeout(() => {
      console.error('🚨 Test replay timed out after 10 seconds, forcing state reset');
      this.forceResetReplayState();
    }, 10000); // 10 second timeout

    this.overlay.textContent = `Replaying: ${test.name}`;
    this.overlay.style.display = 'block';
    this.overlay.style.background = '#1d4ed8';

    const startTime = Date.now();

    try {
      // Execute test steps from the beginning - navigation steps will handle URL navigation
      await this.executeTestSteps(test, 0, startTime);

    } catch (error) {
      console.error('❌ Replay failed:', error);
      this.handleTestFailure(test, error, startTime);
      // Ensure state is reset even if handleTestFailure fails
      if (this.isReplaying) {
        console.warn('⚠️ State still locked after error, forcing reset');
        this.forceResetReplayState();
      }
    } finally {
      // Always clear timeout when test completes (success or failure)
      if (this.currentReplayTimeout) {
        clearTimeout(this.currentReplayTimeout);
        this.currentReplayTimeout = null;
      }
      // Double-check state is reset
      if (this.isReplaying) {
        console.warn('⚠️ State still locked in finally block, forcing reset');
        this.forceResetReplayState();
      }
    }
  }

  async saveTestExecutionState(test, currentStepIndex, startTime) {
    try {
      // Content script doesn't have access to chrome.tabs
      // Background script will determine the tab ID from sender
      await chrome.runtime.sendMessage({
        action: 'saveTestExecutionState',
        testData: test,
        currentStepIndex: currentStepIndex,
        startTime: startTime
      });
    } catch (error) {
      console.error('Failed to save test execution state:', error);
    }
  }

  async resumeTest(executionState) {
    if (this.isReplaying) return;

    console.log('🔄 Resuming test from saved state:', executionState);

    // Clear any previous interruption flag
    this.isTestInterrupted = false;

    this.isReplaying = true;
    this.overlay.textContent = `Resuming test...`;
    this.overlay.style.display = 'block';
    this.overlay.style.background = '#1d4ed8';

    try {
      await this.executeTestSteps(
        executionState.testData,
        executionState.currentStepIndex,
        executionState.startTime
      );
    } catch (error) {
      console.error('Failed to resume test:', error);
      this.handleTestFailure(executionState.testData, error, executionState.startTime);
    }
  }

  // Force reset replay state - used for recovery
  forceStopTest(executionId = null) {
    console.log(`🛑 Force stopping test (execution ID: ${executionId})`);

    // If execution ID is provided, only stop if it matches current test
    if (executionId && this.currentExecutionId && this.currentExecutionId !== executionId) {
      console.log(`⚠️ Execution ID mismatch - current: ${this.currentExecutionId}, requested: ${executionId}`);
      return;
    }

    if (!this.isReplaying) {
      console.log('⚠️ No test is currently replaying');
      return;
    }

    console.log(`  Stopping test execution for ID: ${this.currentExecutionId}`);

    // Set interruption flag to stop ongoing test execution
    this.isTestInterrupted = true;

    // Reset replay state
    this.isReplaying = false;
    this.currentExecutionId = null;

    if (this.currentReplayTimeout) {
      clearTimeout(this.currentReplayTimeout);
      this.currentReplayTimeout = null;
    }

    if (this.overlay) {
      this.overlay.textContent = 'Test stopped by user';
      this.overlay.style.background = '#ef4444';
      // Hide after showing message
      setTimeout(() => {
        if (this.overlay) {
          this.overlay.style.display = 'none';
        }
      }, 2000);
    }

    // Clear execution state from background
    try {
      chrome.runtime.sendMessage({ action: 'clearTestExecutionState' });
    } catch (error) {
      console.warn('Failed to clear execution state during force stop:', error);
    }

    // Notify popup that test was stopped
    try {
      chrome.runtime.sendMessage({
        action: 'testCompleted',
        testName: 'Force Stopped',
        executionId: executionId,
        forceStopped: true
      });
    } catch (error) {
      console.warn('Failed to notify popup of force stop:', error);
    }

    // Reset interruption flag after a short delay to allow for cleanup
    setTimeout(() => {
      this.isTestInterrupted = false;
      console.log('🔄 Interruption flag cleared, ready for new tests');
    }, 1000);

    console.log('✅ Test forcefully stopped');
  }

  forceResetReplayState() {
    console.log('🔄 Force resetting replay state');
    console.log(`  Before reset - isReplaying: ${this.isReplaying}`);

    this.isReplaying = false;
    this.isTestInterrupted = false; // Clear interruption flag
    this.currentExecutionId = null; // Clear execution ID

    if (this.currentReplayTimeout) {
      clearTimeout(this.currentReplayTimeout);
      this.currentReplayTimeout = null;
    }

    if (this.overlay) {
      this.overlay.style.display = 'none';
    }

    // Clear any pending execution state
    try {
      chrome.runtime.sendMessage({ action: 'clearTestExecutionState' });
    } catch (error) {
      console.warn('Failed to clear execution state during force reset:', error);
    }

    console.log(`  After reset - isReplaying: ${this.isReplaying}`);
    console.log('✅ Force reset completed - you can now start a new test');
  }

  // Debug helper to check current state
  checkState() {
    console.log('🔍 Current E2E Test State:');
    console.log(`  isReplaying: ${this.isReplaying}`);
    console.log(`  isRecording: ${this.isRecording}`);
    console.log(`  currentTestName: ${this.currentTestName}`);
    console.log(`  hasTimeout: ${!!this.currentReplayTimeout}`);
    console.log(`  overlay visible: ${this.overlay?.style?.display !== 'none'}`);
    return {
      isReplaying: this.isReplaying,
      isRecording: this.isRecording,
      canStartNewTest: !this.isReplaying && !this.isRecording
    };
  }

  async executeTestSteps(test, startStepIndex, startTime) {
    // Handle both old format (direct array) and new format (object with steps property)
    const steps = Array.isArray(test) ? test : (test.steps || test);
    const testName = test.name || 'Unnamed Test';

    console.log(`🎬 Executing ${steps.length} steps for "${testName}" starting from step ${startStepIndex}`);

    try {
      for (let i = startStepIndex; i < steps.length; i++) {
        const step = steps[i];

        // Check if test execution was cancelled or interrupted
        if (!this.isReplaying || this.isTestInterrupted) {
          console.log(`🛑 Test execution was ${this.isTestInterrupted ? 'interrupted' : 'cancelled'}`);
          return;
        }

        console.log(`📍 Executing step ${i + 1}/${steps.length}: ${step.type}`);

        // Save progress before each step (in case of navigation)
        await this.saveTestExecutionState(test, i + 1, startTime);

        // Send progress update to popup
        try {
          chrome.runtime.sendMessage({
            action: 'testProgress',
            testName: testName,
            currentStep: i + 1,
            totalSteps: steps.length,
            executionId: this.currentExecutionId
          });
        } catch (error) {
          // Ignore error, progress update is not critical
        }

        await this.executeStep(step, i + 1, steps.length);

        // Update progress in overlay
        const progress = Math.round(((i + 1) / steps.length) * 100);
        this.overlay.textContent = `Replaying: ${testName} (${progress}%)`;

        await this.delay(this.settings.replayDelay);
      }

      // Test completed successfully
      console.log(`✅ All steps completed for "${testName}"`);
      await this.handleTestSuccess(testName, steps.length, startTime);

    } catch (error) {
      console.error(`💥 Test execution failed at step: ${error.message}`);
      throw error; // Re-throw to be handled by caller
    }
  }

  async handleTestSuccess(testName, totalSteps, startTime) {
    this.overlay.textContent = `✓ Replay completed: ${testName}`;
    this.overlay.style.background = '#10b981';

    const duration = Date.now() - startTime;
    this.showTestResult(true, testName, totalSteps, null, duration);

    console.log(`✅ Test "${testName}" completed successfully in ${duration}ms`);

    // Immediately reset replay state to prevent UI inconsistency
    const completedExecutionId = this.currentExecutionId;
    this.isReplaying = false;
    this.isTestInterrupted = false;
    this.currentExecutionId = null;

    // Clear timeout if any
    if (this.currentReplayTimeout) {
      clearTimeout(this.currentReplayTimeout);
      this.currentReplayTimeout = null;
    }

    // Notify popup about test completion with delay to ensure UI sees the success state
    try {
      chrome.runtime.sendMessage({
        action: 'testCompleted',
        testName: testName,
        duration: duration,
        executionId: completedExecutionId
      });
    } catch (error) {
      console.warn('Failed to notify popup about test completion:', error);
    }

    // Clean up execution state
    await this.cleanupTestExecution();
  }

  async cleanupTestExecution() {
    try {
      await chrome.runtime.sendMessage({ action: 'clearTestExecutionState' });
      console.log('🧹 Test execution state cleaned up');
    } catch (error) {
      console.warn('Failed to clear execution state:', error);
    }

    // Reset all state immediately instead of using setTimeout
    this.isReplaying = false;
    this.isTestInterrupted = false; // Clear interruption flag
    if (this.currentReplayTimeout) {
      clearTimeout(this.currentReplayTimeout);
      this.currentReplayTimeout = null;
    }

    // Hide overlay after brief delay for visual feedback
    setTimeout(() => {
      if (this.overlay) {
        this.overlay.style.display = 'none';
      }
    }, 2000);
  }

  handleTestFailure(test, error, startTime) {
    const steps = Array.isArray(test) ? test : (test.steps || test);
    const testName = test.name || 'Unnamed Test';

    console.error(`❌ Test "${testName}" failed:`, error);
    console.log(`🔄 Current isReplaying state before cleanup: ${this.isReplaying}`);

    // Immediately reset replay state to prevent UI inconsistency
    const failedExecutionId = this.currentExecutionId;
    this.isReplaying = false;
    this.isTestInterrupted = false;
    this.currentExecutionId = null;

    // Clear timeout if any
    if (this.currentReplayTimeout) {
      clearTimeout(this.currentReplayTimeout);
      this.currentReplayTimeout = null;
    }

    console.log(`✅ Current isReplaying state after cleanup: ${this.isReplaying}`);

    // Notify popup about test failure
    try {
      chrome.runtime.sendMessage({
        action: 'testFailed',
        testName: testName,
        error: error.message,
        executionId: failedExecutionId
      });
    } catch (msgError) {
      console.warn('Failed to notify popup about test failure:', msgError);
    }

    // Now handle UI updates
    this.overlay.textContent = `✗ Replay failed: ${error.message}`;
    this.overlay.style.background = '#dc2626';
    this.overlay.style.display = 'block';
    this.overlay.style.zIndex = '10003';

    this.showScreenshotIndicator(`❌ Test Failed: ${error.message.substring(0, 50)}...`, 3000);

    const duration = Date.now() - startTime;

    // Show test result modal (this could potentially fail, so we do it after cleanup)
    try {
      this.showTestResult(false, testName, steps.length, error.message, duration);
    } catch (uiError) {
      console.error('Failed to show test result modal:', uiError);
    }

    // Show failure overlay slightly longer but state is already reset
    setTimeout(() => {
      if (this.overlay) {
        this.overlay.style.display = 'none';
      }
    }, 5000);
  }

  cleanupTestExecutionSync() {
    console.log('🧹 Synchronous cleanup after test failure');
    console.log(`  Cleanup starting - isReplaying was: ${this.isReplaying}`);

    // Reset state immediately - multiple assignments to be sure
    this.isReplaying = false;

    // Clear timeout if exists
    if (this.currentReplayTimeout) {
      clearTimeout(this.currentReplayTimeout);
      this.currentReplayTimeout = null;
    }

    // Double check and force reset again
    if (this.isReplaying === true) {
      console.error('⚠️ CRITICAL: isReplaying still true after reset, forcing to false');
      this.isReplaying = false;
    }

    // Clear execution state (fire and forget)
    try {
      chrome.runtime.sendMessage({ action: 'clearTestExecutionState' });
    } catch (error) {
      console.warn('Failed to clear execution state during sync cleanup:', error);
    }

    console.log(`  Cleanup complete - isReplaying is now: ${this.isReplaying}`);

    // Final verification
    if (this.isReplaying !== false) {
      console.error('🚨 CRITICAL ERROR: State reset failed! Manual intervention required');
      console.error('Run: window.e2eContentScript.isReplaying = false');
      // Force it one more time
      this.isReplaying = false;
    }
  }

  async executeStep(step, currentStep, totalSteps) {
    // Check for interruption at the start of each step
    if (this.isTestInterrupted) {
      console.log('🛑 Step execution interrupted');
      throw new Error('Test execution was interrupted');
    }

    this.overlay.textContent = `Replaying: ${currentStep}/${totalSteps}`;

    // Handle screenshot steps differently (no element interaction needed)
    if (step.type === 'screenshot') {
      // Show visual indicator for screenshot step
      this.overlay.textContent = `Screenshot checkpoint: ${currentStep}/${totalSteps}`;
      this.showScreenshotIndicator('Comparing visual checkpoint...');

      // Capture current screenshot for comparison
      let visualDiff = null;
      if (step.screenshot) {
        try {
          console.log('Starting screenshot capture for comparison...');

          // Restore scroll position if available
          console.log('Screenshot step:', step); // 전체 step 객체 확인
          if (step.scrollPosition) {
            console.log(`📍 Restoring screenshot scroll position: x=${step.scrollPosition.x}, y=${step.scrollPosition.y}`);
            // 다양한 방법으로 스크롤 시도
            window.scrollTo(step.scrollPosition.x, step.scrollPosition.y);
            document.documentElement.scrollTop = step.scrollPosition.y;
            document.documentElement.scrollLeft = step.scrollPosition.x;
            document.body.scrollTop = step.scrollPosition.y;
            document.body.scrollLeft = step.scrollPosition.x;
            await this.delay(300); // Wait for scroll to complete
          } else {
            console.warn('⚠️ No scroll position found in screenshot step'); // 경고 추가
          }

          // Hide all indicators before taking screenshot to avoid interference
          this.hideAllIndicators();
          await this.delay(200); // Brief delay to ensure indicators are hidden

          const currentScreenshot = await this.captureScreenshot();
          console.log('Current screenshot captured, length:', currentScreenshot?.length);

          if (currentScreenshot) {
            this.showScreenshotIndicator('Comparing screenshots...', 500);
            await this.delay(500);

            console.log('Starting screenshot comparison...');
            visualDiff = await this.compareScreenshots(step.screenshot, currentScreenshot);
            console.log(`Screenshot comparison result: ${visualDiff.differencePercentage.toFixed(2)}% difference`);
          } else {
            console.warn('No current screenshot captured');
          }
        } catch (error) {
          console.error('Failed to capture screenshot for comparison:', error);
          this.showScreenshotIndicator(`❌ Screenshot comparison failed: ${error.message}`, 2000);
          // Continue with test even if screenshot comparison fails
          visualDiff = null;
        }
      }

      // Show visual diff if there's a significant difference
      if (visualDiff && visualDiff.differencePercentage > 0.1) {
        this.showScreenshotIndicator(`⚠️ Visual difference detected: ${visualDiff.differencePercentage.toFixed(2)}%`);
        const userChoice = await this.showVisualDiff(visualDiff, step, currentStep);
        if (userChoice === 'stop') {
          throw new Error(`Visual regression test failed at step ${currentStep}: ${visualDiff.differencePercentage.toFixed(2)}% difference detected`);
        } else if (userChoice === 'update') {
          // Update baseline screenshot
          await this.updateBaselineScreenshot(step, visualDiff.current, currentStep);
          this.showScreenshotIndicator('✓ Baseline updated, continuing test');
        } else {
          this.showScreenshotIndicator('✓ Visual difference accepted, continuing test');
        }
      } else if (visualDiff) {
        this.showScreenshotIndicator(`✓ Visual checkpoint passed (${visualDiff.differencePercentage.toFixed(2)}% diff)`);
      } else {
        this.showScreenshotIndicator('✓ Visual checkpoint completed');
      }

      // Keep indicator visible briefly
      await this.delay(1000);
      return; // Skip element-based logic
    }

    // Handle navigation steps differently (no element interaction needed)
    if (step.type === 'navigation') {
      this.overlay.textContent = `Navigating: ${currentStep}/${totalSteps}`;

      if (step.action === 'start') {
        // Initial step - ensure we're at the starting URL
        if (step.toUrl && step.toUrl !== window.location.href) {
          console.log(`🎬 Starting test at: ${step.toUrl}`);
          this.showScreenshotIndicator(`🎬 Starting test at ${step.toUrl}`, 2000);
          window.location.href = step.toUrl;
          return;
        } else {
          console.log(`✅ Already at starting URL: ${step.toUrl || 'current page'}`);
          this.showScreenshotIndicator('🎬 Test starting at correct page', 1000);
          await this.delay(1000);
          return;
        }
      } else if (step.toUrl && step.toUrl !== window.location.href) {
        console.log(`🔗 Navigating to: ${step.toUrl}`);
        this.showScreenshotIndicator(`🔗 Navigating to ${step.toUrl}`, 2000);

        // Navigate to the URL
        window.location.href = step.toUrl;
        // Navigation will interrupt execution - the test will continue after page load
        return;
      } else {
        console.log(`✅ Already at target URL: ${step.toUrl || 'current page'}`);
        this.showScreenshotIndicator('✅ Navigation step completed', 1000);
        await this.delay(1000);
        return;
      }
    }

    console.log(`🔍 Step ${currentStep}: ${step.type} on "${step.selector}"`);
    if (step.text && step.text.trim()) {
      console.log(`🔍 Expected text: "${step.text}"`);
    }

    // Use improved element finding with retries and waiting
    const element = await this.findElementWithRetry(step.selector, {
      maxAttempts: 5,
      waitBetweenAttempts: 1000,
      waitForElement: true,
      expectedText: step.text // Pass expected text for filtering
    });

    if (!element) {
      const errorMsg = `Element not found after retries: ${step.selector}`;
      console.error(`❌ ${errorMsg}`);
      console.log('💡 Tip: The page structure may have changed. Try re-recording this test.');

      // Show more helpful error to user
      this.showScreenshotIndicator(`❌ Step ${currentStep} failed: Element not found`, 3000);
      throw new Error(errorMsg);
    }

    console.log(`✅ Element found: ${element.tagName}${element.id ? '#' + element.id : ''}`);

    // Ensure element is visible and scroll is complete first
    await this.scrollToElementAndWait(element);

    // Now highlight the element when it's visible
    this.highlightElement(element);

    // Capture current screenshot for visual comparison
    let visualDiff = null;
    if (step.screenshot) {
      try {
        console.log('Capturing element screenshot for comparison...');

        // Get appropriate scroll position based on step type
        let scrollPosition = null;
        if (step.scrollPosition) {
          if (step.type === 'click' && step.scrollPosition.after) {
            // Use scroll position after the click action was recorded
            scrollPosition = step.scrollPosition.after;
          } else if (step.scrollPosition.x !== undefined && step.scrollPosition.y !== undefined) {
            // Use simple scroll position for input/change steps
            scrollPosition = step.scrollPosition;
          }
        }

        const currentScreenshot = await this.captureElementScreenshot(element, scrollPosition);
        if (currentScreenshot) {
          console.log('Element screenshot captured, comparing...');
          visualDiff = await this.compareScreenshots(step.screenshot, currentScreenshot);
          console.log(`Element screenshot comparison result: ${visualDiff.differencePercentage.toFixed(2)}% difference`);
        } else {
          console.warn('No element screenshot captured');
        }
      } catch (error) {
        console.error('Failed to capture/compare element screenshot:', error);
        // Continue with test even if screenshot comparison fails
        visualDiff = null;
      }
    }

    try {
      switch (step.type) {
        case 'click':
          // Text validation is now done in findElementWithRetry
          console.log(`✅ Clicking element with text: "${element.textContent?.trim() || 'no text'}"`);
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
        default:
          console.warn(`⚠️ Unknown step type: ${step.type}`);
      }
      console.log(`✅ ${step.type} executed`);
    } catch (actionError) {
      console.error(`❌ Failed to execute ${step.type}:`, actionError);
      throw new Error(`Action execution failed: ${actionError.message}`);
    }

    // Show visual diff if there's a significant difference
    if (visualDiff && visualDiff.differencePercentage > 0.1) {
      const userChoice = await this.showVisualDiff(visualDiff, step, currentStep);
      if (userChoice === 'stop') {
        throw new Error(`Visual regression test failed at step ${currentStep}`);
      } else if (userChoice === 'update') {
        // Update baseline screenshot for this step
        await this.updateBaselineScreenshot(step, visualDiff.current, currentStep);
        console.log(`Baseline screenshot updated for step ${currentStep}`);
      }
    }

    // Keep highlight visible briefly after action
    await this.delay(200); // Fixed short delay for highlight visibility
    this.clearHighlight();
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async scrollToElementAndWait(element) {
    return new Promise((resolve) => {
      // 항상 요소를 정확한 위치로 스크롤 (뷰포트에 보여도 무조건 스크롤)
      console.log('📍 Scrolling element to center position...');

      // Store initial scroll position
      const initialScrollY = window.scrollY;
      const initialScrollX = window.scrollX;

      // 무조건 center로 스크롤
      element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });

      // Wait for scroll to complete
      const checkScroll = () => {
        const currentScrollY = window.scrollY;
        const currentScrollX = window.scrollX;

        // Check if scroll has stopped (position hasn't changed for a bit)
        setTimeout(() => {
          if (Math.abs(window.scrollY - currentScrollY) < 1 && Math.abs(window.scrollX - currentScrollX) < 1) {
            // Scroll has stopped, check if element is now visible
            const newRect = element.getBoundingClientRect();
            const isNowVisible = (
              newRect.top >= 0 &&
              newRect.left >= 0 &&
              newRect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
              newRect.right <= (window.innerWidth || document.documentElement.clientWidth)
            );

            if (isNowVisible || Math.abs(initialScrollY - window.scrollY) > 0 || Math.abs(initialScrollX - window.scrollX) > 0) {
              // Element is visible or we've scrolled (even if not perfectly visible)
              console.log('✅ Scroll completed to exact position');
              resolve();
            } else {
              // Try again
              checkScroll();
            }
          } else {
            // Still scrolling, check again
            checkScroll();
          }
        }, 100);
      };

      checkScroll();
    });
  }

  async compareScreenshots(baselineDataUrl, currentDataUrl) {
    return new Promise((resolve, reject) => {
      console.log('Starting compareScreenshots...');
      const canvas = document.createElement('canvas');
      // Set willReadFrequently to true for better performance with getImageData
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      const baselineImg = new Image();
      const currentImg = new Image();

      let loadedCount = 0;
      let isResolved = false;

      // Set timeout to prevent infinite waiting
      const timeout = setTimeout(() => {
        if (!isResolved) {
          console.error('Screenshot comparison timed out after 8 seconds');
          isResolved = true;
          reject(new Error('Screenshot comparison timed out after 8 seconds'));
        }
      }, 8000); // Reduced from 15 seconds to 8 seconds

      const processImages = () => {
        if (isResolved || loadedCount !== 2) return;

        console.log('Both images loaded, starting comparison...');
        try {
          const width = Math.max(baselineImg.width, currentImg.width);
          const height = Math.max(baselineImg.height, currentImg.height);
          console.log(`Comparing images: ${width}x${height}`);

          // Validate image dimensions
          if (width <= 0 || height <= 0 || width > 5000 || height > 5000) {
            throw new Error(`Invalid image dimensions: ${width}x${height}`);
          }

          canvas.width = width;
          canvas.height = height;

          // Draw baseline image
          ctx.drawImage(baselineImg, 0, 0);
          let baselineData, currentData;

          try {
            baselineData = ctx.getImageData(0, 0, width, height);
          } catch (error) {
            throw new Error(`Failed to get baseline image data: ${error.message}`);
          }

          // Clear and draw current image
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(currentImg, 0, 0);

          try {
            currentData = ctx.getImageData(0, 0, width, height);
          } catch (error) {
            throw new Error(`Failed to get current image data: ${error.message}`);
          }

          // Create diff image
          const diffData = ctx.createImageData(width, height);
          let diffPixels = 0;
          const totalPixels = width * height;

          for (let i = 0; i < baselineData.data.length; i += 4) {
            const rDiff = Math.abs(baselineData.data[i] - currentData.data[i]);
            const gDiff = Math.abs(baselineData.data[i + 1] - currentData.data[i + 1]);
            const bDiff = Math.abs(baselineData.data[i + 2] - currentData.data[i + 2]);

            const diff = (rDiff + gDiff + bDiff) / 3;

            if (diff > 10) { // Threshold for significant difference
              diffPixels++;
              diffData.data[i] = 255;     // Red
              diffData.data[i + 1] = 0;   // Green
              diffData.data[i + 2] = 0;   // Blue
              diffData.data[i + 3] = 128; // Alpha
            } else {
              diffData.data[i] = currentData.data[i];
              diffData.data[i + 1] = currentData.data[i + 1];
              diffData.data[i + 2] = currentData.data[i + 2];
              diffData.data[i + 3] = 50; // Lower alpha for unchanged areas
            }
          }

          // Draw diff image
          ctx.clearRect(0, 0, width, height);
          ctx.putImageData(diffData, 0, 0);
          const diffDataUrl = canvas.toDataURL('image/png');

          const differencePercentage = (diffPixels / totalPixels) * 100;
          console.log(`Comparison completed: ${differencePercentage.toFixed(2)}% difference`);

          clearTimeout(timeout);
          isResolved = true;
          resolve({
            baseline: baselineDataUrl,
            current: currentDataUrl,
            diff: diffDataUrl,
            differencePercentage: differencePercentage,
            diffPixels: diffPixels,
            totalPixels: totalPixels
          });
        } catch (error) {
          console.error('Error during image processing:', error);
          clearTimeout(timeout);
          isResolved = true;
          reject(error);
        }
      };

      const handleImageError = (imageType, error) => {
        if (!isResolved) {
          console.error(`Failed to load ${imageType} image:`, error);
          clearTimeout(timeout);
          isResolved = true;
          reject(new Error(`Failed to load ${imageType} image`));
        }
      };

      baselineImg.onload = () => {
        console.log('Baseline image loaded');
        loadedCount++;
        processImages();
      };

      baselineImg.onerror = (error) => handleImageError('baseline', error);

      currentImg.onload = () => {
        console.log('Current image loaded');
        loadedCount++;
        processImages();
      };

      currentImg.onerror = (error) => handleImageError('current', error);

      console.log('Setting image sources...');
      baselineImg.src = baselineDataUrl;
      currentImg.src = currentDataUrl;
    });
  }

  showVisualDiff(visualDiff, step, stepNumber) {
    // Create visual diff overlay
    const diffOverlay = document.createElement('div');
    diffOverlay.id = 'e2e-visual-diff-overlay';
    diffOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      z-index: 2147483647;
      display: flex;
      justify-content: center;
      align-items: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    const diffModal = document.createElement('div');
    diffModal.style.cssText = `
      background: white;
      border-radius: 8px;
      padding: 20px;
      max-width: 90%;
      max-height: 90%;
      overflow: auto;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
    `;

    diffModal.innerHTML = `
      <div style="margin-bottom: 15px;">
        <h3 style="margin: 0 0 10px 0; color: #dc2626;">Visual Regression Detected</h3>
        <p style="margin: 0; color: #6b7280;">
          Step ${stepNumber}: ${step.type} on "${step.selector}"<br>
          Difference: ${visualDiff.differencePercentage.toFixed(2)}%
          (${visualDiff.diffPixels.toLocaleString()} pixels changed)
        </p>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; margin-bottom: 20px;">
        <div>
          <h4 style="margin: 0 0 10px 0; text-align: center;">Baseline</h4>
          <img src="${visualDiff.baseline}" style="width: 100%; border: 1px solid #e5e7eb; border-radius: 4px;">
        </div>
        <div>
          <h4 style="margin: 0 0 10px 0; text-align: center;">Current</h4>
          <img src="${visualDiff.current}" style="width: 100%; border: 1px solid #e5e7eb; border-radius: 4px;">
        </div>
        <div>
          <h4 style="margin: 0 0 10px 0; text-align: center;">Diff</h4>
          <img src="${visualDiff.diff}" style="width: 100%; border: 1px solid #e5e7eb; border-radius: 4px;">
        </div>
      </div>

      <div style="text-align: center;">
        <button id="update-baseline" style="
          background: #3b82f6;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 6px;
          margin-right: 10px;
          cursor: pointer;
        ">Update Baseline</button>
        <button id="continue-test" style="
          background: #10b981;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 6px;
          margin-right: 10px;
          cursor: pointer;
        ">Continue Test</button>
        <button id="stop-test" style="
          background: #dc2626;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 6px;
          cursor: pointer;
        ">Stop Test</button>
      </div>
    `;

    diffOverlay.appendChild(diffModal);
    document.body.appendChild(diffOverlay);

    // Add event listeners
    return new Promise((resolve) => {
      document.getElementById('update-baseline').addEventListener('click', () => {
        document.body.removeChild(diffOverlay);
        resolve('update');
      });

      document.getElementById('continue-test').addEventListener('click', () => {
        document.body.removeChild(diffOverlay);
        resolve('continue');
      });

      document.getElementById('stop-test').addEventListener('click', () => {
        document.body.removeChild(diffOverlay);
        resolve('stop');
      });
    });
  }
}

// Initialize content script
function initializeE2EContentScript() {
  if (window.e2eContentScript) {
    console.log('E2E Content Script instance already exists, skipping initialization...');
    console.log('Current state:', window.e2eContentScript.checkState());
    return;
  }

  window.e2eContentScript = new E2EContentScript();
  window.E2EContentScript = E2EContentScript; // Mark class as loaded
  console.log('E2E Content Script initialized');
  console.log('Global access: window.e2eContentScript');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeE2EContentScript);
} else {
  initializeE2EContentScript();
}

} // End of the if block that prevents multiple loading