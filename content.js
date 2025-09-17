class E2EContentScript {
  constructor() {
    this.isRecording = false;
    this.isReplaying = false;
    this.currentTestName = null;
    this.recordedSteps = [];
    this.highlightedElement = null;
    this.overlay = null;
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

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      switch (message.action) {
        case 'ping':
          // Simple ping to verify content script is alive and responsive
          sendResponse({ success: true, message: 'Content script is ready' });
          break;
        case 'startRecording':
          this.startRecording(message.testName);
          break;
        case 'stopRecording':
          this.stopRecording();
          break;
        case 'replayTest':
          this.replayTest(message.test);
          break;
        case 'captureFullPageScreenshot':
          this.captureFullPageScreenshot()
            .then(screenshot => sendResponse({ screenshot }))
            .catch(error => sendResponse({ error: error.message }));
          return true; // Keep message channel open for async response
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

  async captureFullPageScreenshot() {
    try {
      // Show progress overlay
      this.showScreenshotProgress('Capturing screenshot...');

      // Simply capture the current viewport for now
      const screenshot = await this.captureScreenshot();

      // Hide progress overlay
      this.hideScreenshotProgress();

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
  }

  removeRecordingListeners() {
    document.removeEventListener('click', this.handleClick, true);
    document.removeEventListener('input', this.handleInput, true);
    document.removeEventListener('change', this.handleChange, true);
    document.removeEventListener('mouseover', this.handleMouseOver, true);
    document.removeEventListener('mouseout', this.handleMouseOut, true);
    document.removeEventListener('keydown', this.handleKeyDown, true);
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

  async captureElementScreenshot(element) {
    try {
      // Scroll element into view
      element.scrollIntoView({ behavior: 'auto', block: 'center' });
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
        await this.delay(this.settings.replayDelay);
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
      this.overlay.style.display = 'block'; // Ensure it's visible
      this.overlay.style.zIndex = '10003'; // Higher z-index

      // Also show a prominent error indicator with longer duration
      this.showScreenshotIndicator(`❌ Test Failed: ${error.message.substring(0, 50)}...`, 3000);

      setTimeout(() => {
        this.overlay.style.display = 'none';
      }, 5000); // Longer display time for errors
    }

    this.isReplaying = false;
  }

  async executeStep(step, currentStep, totalSteps) {
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
          this.showScreenshotIndicator('Capturing current screenshot...', 500);
          await this.delay(500);

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
      if (visualDiff && visualDiff.differencePercentage > 5) {
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

    const element = document.querySelector(step.selector);
    if (!element) {
      throw new Error(`Element not found: ${step.selector}`);
    }

    // Ensure element is visible and scroll is complete first
    await this.scrollToElementAndWait(element);

    // Now highlight the element when it's visible
    this.highlightElement(element);

    // Capture current screenshot for visual comparison
    let visualDiff = null;
    if (step.screenshot) {
      try {
        console.log('Capturing element screenshot for comparison...');
        const currentScreenshot = await this.captureElementScreenshot(element);
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

    // Show visual diff if there's a significant difference
    if (visualDiff && visualDiff.differencePercentage > 5) {
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
      const rect = element.getBoundingClientRect();
      const isInViewport = (
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
        rect.right <= (window.innerWidth || document.documentElement.clientWidth)
      );

      if (isInViewport) {
        // Element is already visible, no need to scroll
        resolve();
        return;
      }

      // Store initial scroll position
      const initialScrollY = window.scrollY;
      const initialScrollX = window.scrollX;

      // Start scrolling
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
      const ctx = canvas.getContext('2d');

      const baselineImg = new Image();
      const currentImg = new Image();

      let loadedCount = 0;
      let isResolved = false;

      // Set timeout to prevent infinite waiting
      const timeout = setTimeout(() => {
        if (!isResolved) {
          console.error('Screenshot comparison timed out after 15 seconds');
          isResolved = true;
          reject(new Error('Screenshot comparison timed out'));
        }
      }, 15000);

      const processImages = () => {
        if (isResolved || loadedCount !== 2) return;

        console.log('Both images loaded, starting comparison...');
        try {
          const width = Math.max(baselineImg.width, currentImg.width);
          const height = Math.max(baselineImg.height, currentImg.height);
          console.log(`Comparing images: ${width}x${height}`);

          canvas.width = width;
          canvas.height = height;

          // Draw baseline image
          ctx.drawImage(baselineImg, 0, 0);
          const baselineData = ctx.getImageData(0, 0, width, height);

          // Clear and draw current image
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(currentImg, 0, 0);
          const currentData = ctx.getImageData(0, 0, width, height);

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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', async () => {
    new E2EContentScript();
  });
} else {
  new E2EContentScript();
}