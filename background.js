class E2EBackgroundScript {
  constructor() {
    this.init();
  }

  init() {
    this.setupInstallListener();
    this.setupTabUpdateListener();
    this.setupCommandListener();
    this.setupContextMenu();
    this.setupMessageListener();
    this.setupTestExecutionTabListener();
  }

  setupInstallListener() {
    chrome.runtime.onInstalled.addListener((details) => {
      if (details.reason === 'install') {
        console.log('E2E Test Recorder installed');
        this.initializeStorage();
      } else if (details.reason === 'update') {
        console.log('E2E Test Recorder updated');
        this.migrateData();
      }
    });
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('Background received message:', message);

      switch (message.action) {
        case 'captureScreenshot':
          this.captureScreenshot(sender.tab?.id)
            .then(dataUrl => {
              console.log('Screenshot captured successfully');
              sendResponse({ dataUrl });
            })
            .catch(error => {
              console.error('Screenshot capture error in background:', error);
              sendResponse({ error: error.message });
            });
          return true; // Keep message channel open for async response
        case 'injectContentScript':
          this.injectContentScript(message.tabId)
            .then(() => {
              console.log('Content script injection completed');
              sendResponse({ success: true });
            })
            .catch(error => {
              console.error('Content script injection failed:', error);
              sendResponse({ error: error.message });
            });
          return true; // Keep message channel open for async response
        case 'updateStepScreenshot':
          this.updateStepScreenshot(message.stepNumber, message.newScreenshot, message.stepData)
            .then(() => {
              console.log('Step screenshot updated successfully');
              sendResponse({ success: true });
            })
            .catch(error => {
              console.error('Step screenshot update failed:', error);
              sendResponse({ error: error.message });
            });
          return true; // Keep message channel open for async response
        case 'saveTestExecutionState':
          this.saveTestExecutionState(
            message.tabId || sender.tab?.id,
            message.testData,
            message.currentStepIndex,
            message.startTime
          )
            .then(() => {
              sendResponse({ success: true });
            })
            .catch(error => {
              sendResponse({ error: error.message });
            });
          return true;
        case 'getTestExecutionState':
          this.getTestExecutionState(message.tabId || sender.tab?.id)
            .then(state => {
              sendResponse({ state });
            })
            .catch(error => {
              sendResponse({ error: error.message });
            });
          return true;
        case 'clearTestExecutionState':
          this.clearTestExecutionState(message.tabId || sender.tab?.id)
            .then(() => {
              sendResponse({ success: true });
            })
            .catch(error => {
              sendResponse({ error: error.message });
            });
          return true;
        default:
          console.log('Unknown action:', message.action);
          sendResponse({ error: 'Unknown action' });
      }
    });
  }

  async captureScreenshot(tabId) {
    try {
      console.log('Attempting to capture screenshot for tab:', tabId);

      // Try to capture the visible tab
      const dataUrl = await chrome.tabs.captureVisibleTab(null, {
        format: 'png'
      });

      console.log('Screenshot data URL length:', dataUrl?.length);
      return dataUrl;
    } catch (error) {
      console.error('Screenshot capture failed:', error);
      throw error;
    }
  }

  setupTabUpdateListener() {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && tab.url) {
        this.injectContentScript(tabId);
      }
    });
  }

  setupCommandListener() {
    if (chrome.commands && chrome.commands.onCommand) {
      chrome.commands.onCommand.addListener((command) => {
        switch (command) {
          case 'toggle-recording':
            this.toggleRecording();
            break;
          case 'quick-replay':
            this.quickReplay();
            break;
        }
      });
    }
  }

  setupContextMenu() {
    if (chrome.contextMenus && chrome.contextMenus.create) {
      chrome.contextMenus.create({
        id: 'e2e-record-element',
        title: 'Record this element',
        contexts: ['all']
      });

      chrome.contextMenus.create({
        id: 'e2e-generate-selector',
        title: 'Generate selector',
        contexts: ['all']
      });

      chrome.contextMenus.onClicked.addListener((info, tab) => {
        switch (info.menuItemId) {
          case 'e2e-record-element':
            this.recordElement(tab.id);
            break;
          case 'e2e-generate-selector':
            this.generateSelector(tab.id);
            break;
        }
      });
    }
  }

  async initializeStorage() {
    const defaultData = {
      e2eTests: [],
      settings: {
        recordingDelay: 100,
        replayDelay: 300
      }
    };

    await chrome.storage.local.set(defaultData);
  }

  async migrateData() {
    const result = await chrome.storage.local.get();

    if (!result.settings) {
      await chrome.storage.local.set({
        settings: {
          recordingDelay: 100,
          replayDelay: 300
        }
      });
    }
  }

  async injectContentScript(tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      });

      await chrome.scripting.insertCSS({
        target: { tabId: tabId },
        files: ['content.css']
      });
    } catch (error) {
      console.log('Could not inject content script:', error);
    }
  }

  async toggleRecording() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { action: 'toggleRecording' });
    }
  }

  async quickReplay() {
    const result = await chrome.storage.local.get(['e2eTests']);
    const tests = result.e2eTests || [];

    if (tests.length > 0) {
      const lastTest = tests[tests.length - 1];
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (tab) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'replayTest',
          test: lastTest
        });
      }
    }
  }

  async recordElement(tabId) {
    chrome.tabs.sendMessage(tabId, { action: 'recordClickedElement' });
  }

  async generateSelector(tabId) {
    chrome.tabs.sendMessage(tabId, { action: 'generateSelectorForElement' });
  }

  async exportAllTests() {
    const result = await chrome.storage.local.get(['e2eTests']);
    const tests = result.e2eTests || [];

    const exportData = {
      format: 'e2e-test-recorder',
      version: '1.0.0',
      exportDate: new Date().toISOString(),
      tests: tests
    };

    return exportData;
  }

  async importTests(importData) {
    if (importData.format !== 'e2e-test-recorder') {
      throw new Error('Invalid import format');
    }

    const result = await chrome.storage.local.get(['e2eTests']);
    const existingTests = result.e2eTests || [];

    const mergedTests = [...existingTests, ...importData.tests];
    await chrome.storage.local.set({ e2eTests: mergedTests });

    return mergedTests.length - existingTests.length;
  }

  async generateTestCode(test, format = 'playwright') {
    let code = '';

    switch (format) {
      case 'playwright':
        code = this.generatePlaywrightCode(test);
        break;
      case 'cypress':
        code = this.generateCypressCode(test);
        break;
      case 'selenium':
        code = this.generateSeleniumCode(test);
        break;
      default:
        throw new Error('Unsupported format');
    }

    return code;
  }

  generatePlaywrightCode(test) {
    let code = `// Generated by E2E Test Recorder\n`;
    code += `// Test: ${test.name}\n`;
    code += `// Generated on: ${new Date().toISOString()}\n\n`;
    code += `import { test, expect } from '@playwright/test';\n\n`;
    code += `test('${test.name}', async ({ page }) => {\n`;
    code += `  await page.goto('${test.url}');\n\n`;

    test.steps.forEach((step, index) => {
      code += `  // Step ${index + 1}\n`;

      switch (step.type) {
        case 'click':
          code += `  await page.click('${step.selector}');\n`;
          break;
        case 'input':
          code += `  await page.fill('${step.selector}', '${step.value}');\n`;
          break;
        case 'change':
          if (typeof step.value === 'boolean') {
            code += `  await page.setChecked('${step.selector}', ${step.value});\n`;
          } else {
            code += `  await page.selectOption('${step.selector}', '${step.value}');\n`;
          }
          break;
        case 'keypress':
          code += `  await page.press('${step.selector}', '${step.key}');\n`;
          break;
      }
      code += '\n';
    });

    code += '});';
    return code;
  }

  generateCypressCode(test) {
    let code = `// Generated by E2E Test Recorder\n`;
    code += `// Test: ${test.name}\n`;
    code += `// Generated on: ${new Date().toISOString()}\n\n`;
    code += `describe('${test.name}', () => {\n`;
    code += `  it('should execute recorded steps', () => {\n`;
    code += `    cy.visit('${test.url}');\n\n`;

    test.steps.forEach((step, index) => {
      code += `    // Step ${index + 1}\n`;

      switch (step.type) {
        case 'click':
          code += `    cy.get('${step.selector}').click();\n`;
          break;
        case 'input':
          code += `    cy.get('${step.selector}').type('${step.value}');\n`;
          break;
        case 'change':
          if (typeof step.value === 'boolean') {
            code += `    cy.get('${step.selector}').${step.value ? 'check' : 'uncheck'}();\n`;
          } else {
            code += `    cy.get('${step.selector}').select('${step.value}');\n`;
          }
          break;
        case 'keypress':
          code += `    cy.get('${step.selector}').type('{${step.key.toLowerCase()}}');\n`;
          break;
      }
      code += '\n';
    });

    code += '  });\n});';
    return code;
  }

  generateSeleniumCode(test) {
    let code = `// Generated by E2E Test Recorder\n`;
    code += `// Test: ${test.name}\n`;
    code += `// Generated on: ${new Date().toISOString()}\n\n`;
    code += `const { Builder, By, Key, until } = require('selenium-webdriver');\n\n`;
    code += `async function ${test.name.replace(/[^a-zA-Z0-9]/g, '_')}() {\n`;
    code += `  let driver = await new Builder().forBrowser('chrome').build();\n`;
    code += `  try {\n`;
    code += `    await driver.get('${test.url}');\n\n`;

    test.steps.forEach((step, index) => {
      code += `    // Step ${index + 1}\n`;

      switch (step.type) {
        case 'click':
          code += `    await driver.findElement(By.css('${step.selector}')).click();\n`;
          break;
        case 'input':
          code += `    await driver.findElement(By.css('${step.selector}')).sendKeys('${step.value}');\n`;
          break;
        case 'change':
          if (typeof step.value === 'boolean') {
            code += `    const checkbox = await driver.findElement(By.css('${step.selector}'));\n`;
            code += `    if (await checkbox.isSelected() !== ${step.value}) {\n`;
            code += `      await checkbox.click();\n`;
            code += `    }\n`;
          } else {
            code += `    await driver.findElement(By.css('${step.selector}')).sendKeys('${step.value}');\n`;
          }
          break;
        case 'keypress':
          code += `    await driver.findElement(By.css('${step.selector}')).sendKeys(Key.${step.key.toUpperCase()});\n`;
          break;
      }
      code += '\n';
    });

    code += '  } finally {\n';
    code += '    await driver.quit();\n';
    code += '  }\n';
    code += '}\n\n';
    code += `${test.name.replace(/[^a-zA-Z0-9]/g, '_')}();`;

    return code;
  }

  async updateStepScreenshot(stepNumber, newScreenshot, stepData) {
    try {
      console.log(`Updating screenshot for step ${stepNumber}`);

      // Get all tests from storage
      const result = await chrome.storage.local.get(['e2eTests']);
      const tests = result.e2eTests || [];

      // Find and update the test that contains this step
      let updated = false;
      for (let test of tests) {
        for (let i = 0; i < test.steps.length; i++) {
          if (test.steps[i].timestamp === stepData.timestamp &&
              test.steps[i].type === stepData.type &&
              test.steps[i].selector === stepData.selector) {
            // Update the screenshot for this step
            test.steps[i].screenshot = newScreenshot;
            updated = true;
            console.log(`Updated screenshot in test "${test.name}", step ${i + 1}`);
            break;
          }
        }
        if (updated) break;
      }

      if (updated) {
        // Save the updated tests back to storage
        await chrome.storage.local.set({ e2eTests: tests });
        console.log('Test data saved with updated screenshot');
      } else {
        console.warn('Could not find matching step to update');
      }

    } catch (error) {
      console.error('Failed to update step screenshot:', error);
      throw error;
    }
  }

  // Test execution state management
  async saveTestExecutionState(tabId, testData, currentStepIndex, startTime) {
    const executionState = {
      tabId: tabId,
      testData: testData,
      currentStepIndex: currentStepIndex,
      startTime: startTime,
      timestamp: Date.now()
    };

    await chrome.storage.local.set({
      [`testExecution_${tabId}`]: executionState
    });

    console.log(`💾 Saved test execution state for tab ${tabId}, step ${currentStepIndex}`);
  }

  async getTestExecutionState(tabId) {
    const result = await chrome.storage.local.get([`testExecution_${tabId}`]);
    return result[`testExecution_${tabId}`] || null;
  }

  async clearTestExecutionState(tabId) {
    await chrome.storage.local.remove([`testExecution_${tabId}`]);
    console.log(`🗑️ Cleared test execution state for tab ${tabId}`);
  }

  setupTestExecutionTabListener() {
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      // Only process when page loading is complete
      if (changeInfo.status === 'complete' && tab.url) {
        console.log(`📄 Page load complete for tab ${tabId}: ${tab.url}`);

        // Check if there's a pending test execution for this tab
        const executionState = await this.getTestExecutionState(tabId);

        if (executionState) {
          console.log(`🔄 Found pending test execution for tab ${tabId}, attempting to resume...`);

          // Wait a bit for content script to be ready
          setTimeout(async () => {
            try {
              // Send resume message to content script
              await chrome.tabs.sendMessage(tabId, {
                action: 'resumeTest',
                executionState: executionState
              });
            } catch (error) {
              console.error(`Failed to resume test in tab ${tabId}:`, error);
              // If content script is not ready, it will check for pending state on init
            }
          }, 1000);
        }
      }
    });
  }
}

new E2EBackgroundScript();