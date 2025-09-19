# E2E Test Recorder - Chrome Extension

Chrome extension for simplified end-to-end testing. Easily record, replay, and manage E2E test scenarios directly in your browser with automated element selection, visual regression testing, and robust error detection.

## Features

### 🎥 **Recording & Replay**
- **Record User Interactions**: Automatically capture clicks, inputs, form submissions, and navigation
- **Smart Element Targeting**: Text content-based element identification for precise targeting
- **Screenshot Capture**: Automatic screenshots at each step for visual verification
- **Initial URL Tracking**: Records starting page for accurate test replay

### 🔍 **Intelligent Element Detection**
- **Multi-layer Selector Strategy**: ID → data-testid → name → classes → parent-child paths
- **Text Content Filtering**: Finds correct element among multiple matches using text content
- **Fallback Prevention**: Disabled alternative selector fallback to prevent false positives
- **Real-time Element Validation**: Ensures elements exist and are interactable before action

### 📸 **Visual Regression Testing**
- **Automatic Screenshot Comparison**: Compares recorded vs replay screenshots
- **Percentage-based Difference Detection**: Shows exact visual change percentage
- **Interactive Visual Diff**: User can accept, reject, or update baseline images
- **Element-level Screenshots**: Captures specific elements for precise comparison

### 🛡️ **Robust Error Detection**
- **Missing Element Detection**: Fails when recorded elements are removed from DOM
- **Text Content Validation**: Ensures element text matches recorded content
- **DOM Structure Verification**: Detects when page structure has changed
- **Precise Error Messages**: Clear indication of what went wrong and where

### ⚡ **Advanced Test Execution**
- **Real-time Progress Tracking**: Shows current step and completion percentage
- **Step-by-step Breakdown**: Detailed view of all test steps with expand/collapse
- **Force Stop Capability**: Emergency stop for stuck or infinite-running tests
- **State Persistence**: Maintains test status across popup close/reopen
- **Navigation Step Recording**: Tracks page transitions and URL changes

### 📊 **Test Management**
- **Unique Test Identification**: Prevents conflicts between tests with same names
- **Execution State Management**: Handles test resumption after navigation
- **Multiple Test Support**: Run different tests without interference
- **Export Functionality**: Save tests as JSON for backup and sharing

## Installation

### From Chrome Web Store
*Coming soon*

### Manual Installation (Developer Mode)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension directory
5. The extension icon will appear in your browser toolbar

## Usage

### Recording a Test

1. Click the extension icon to open the popup
2. Enter a descriptive name for your test
3. Click "Start Recording"
4. Navigate and interact with the web page as needed
5. Click "Stop Recording" when finished

### Replaying a Test

1. Open the extension popup
2. Find your saved test in the list
3. Click "Replay" to execute the test
4. Watch as the extension automatically performs your recorded actions

### Exporting Tests

1. Click "Export" next to any saved test
2. The test will be downloaded as a JSON file
3. Use the background script's code generation features to convert to:
   - Playwright test code
   - Cypress test code
   - Selenium WebDriver code

## Recorded Actions

The extension captures the following user interactions with enhanced accuracy:

### 🖱️ **Click Actions**
- **Button clicks** with text content validation
- **Link navigation** with precise element targeting
- **Checkbox/radio selections** with state verification
- **Element highlighting** during recording for visual feedback

### ⌨️ **Input Actions**
- **Form field entries** with value validation
- **Text area content** with multi-line support
- **Auto-scroll to elements** for better visibility
- **Input event simulation** for framework compatibility

### 🔄 **Navigation Actions**
- **Page URL changes** and redirects
- **Initial page recording** as starting step
- **Before/after navigation events** for complete flow tracking
- **Cross-page test continuation** with state management

### 🎯 **Advanced Interactions**
- **Dropdown selections** with value matching
- **Keyboard events** (Enter, Tab) for form navigation
- **Scroll position tracking** for accurate element positioning
- **Element visibility verification** before interaction

### 📸 **Visual Verification**
- **Automatic screenshots** at each interaction step
- **Element-specific captures** for targeted comparison
- **Visual diff highlighting** for regression detection
- **Baseline image management** for consistent testing

## Technical Details

### Architecture

- **Manifest V3**: Uses the latest Chrome extension architecture
- **Content Script**: Handles page interaction recording and replay
- **Background Script**: Manages data storage and cross-tab communication
- **Popup Interface**: Provides user controls for test management

### Enhanced Selector Strategy

The extension uses a sophisticated multi-layer approach for reliable element targeting:

#### **Priority-based Selection**
1. **Element ID** (`#elementId`) - Highest priority for unique identification
2. **Test attributes** (`[data-testid="value"]`, `[data-cy="value"]`) - QA-friendly selectors
3. **Name attributes** (`[name="fieldName"]`) - Stable for form elements
4. **Semantic attributes** (`[aria-label="value"]`, `[role="button"]`) - Accessibility-focused
5. **Class combinations** (`.class1.class2.class3`) - Multiple classes for specificity
6. **Parent-child relationships** (`div > button.submit`) - Structural positioning

#### **Text Content Filtering**
- **Primary matching**: Exact text content comparison
- **Multi-element handling**: Filters elements by recorded text when multiple matches found
- **Content validation**: Ensures clicked element contains expected text
- **Dynamic content detection**: Identifies when element text has changed

#### **Robustness Features**
- **Alternative selector disabled**: Prevents false positives from generic fallbacks
- **Element existence verification**: Confirms element is still in DOM
- **Visibility checking**: Ensures element is visible and interactable
- **Retry mechanism**: Multiple attempts with configurable timing

#### **Error Prevention**
- **Precise targeting**: No generic class fallbacks that could match wrong elements
- **Text mismatch detection**: Immediate failure when element content differs
- **DOM change detection**: Identifies structural changes that affect targeting
- **Clear error reporting**: Specific messages about what went wrong

### Storage & State Management

- **Local Storage**: Tests stored using Chrome's storage API with no external transmission
- **State Persistence**: Test execution state maintained across popup sessions
- **Cross-tab Handling**: Manages test execution across page navigation
- **Export/Import**: JSON-based backup and sharing functionality
- **Execution History**: Tracks test runs and results for debugging

## QA Team Benefits

### 🚀 **Efficiency Gains**
- **80% Time Reduction**: Automated repetitive testing workflows
- **Parallel Testing**: Run multiple test scenarios simultaneously
- **Consistent Results**: Eliminates human error in manual testing
- **24/7 Testing**: Can be integrated into CI/CD pipelines

### 🎯 **Use Cases**
- **Daily Regression Testing**: Automated morning health checks
- **Pre-deployment Validation**: Complete flow testing before releases
- **Bug Reproduction**: Record exact steps to reproduce issues
- **Cross-browser Testing**: Same tests across different browsers
- **User Journey Validation**: End-to-end user experience testing

### 📊 **Quality Assurance**
- **Visual Regression Detection**: Catch UI changes automatically
- **Functional Validation**: Ensure features work as expected
- **Data Integrity**: Verify form submissions and data processing
- **Performance Monitoring**: Track page load and interaction times

## Development

### Project Structure

```
├── manifest.json       # Extension configuration
├── popup.html         # Extension popup interface
├── popup.js          # Popup logic and test management
├── content.js        # Page interaction recording/replay
├── content.css       # Content script styling
├── background.js     # Background service worker
└── images/          # Extension icons
```

### Key Classes

- `E2ETestRecorder` (popup.js): Manages the popup interface and test storage
- `E2EContentScript` (content.js): Handles page interaction capture and replay
- `E2EBackgroundScript` (background.js): Provides background services and code generation

## Permissions

The extension requires the following permissions:

- `activeTab`: Access to the current tab for recording/replay
- `storage`: Local storage for saving test data
- `scripting`: Injection of content scripts
- `tabs`: Tab management for cross-page testing

## Browser Compatibility

- Chrome 88+ (Manifest V3 support required)
- Chromium-based browsers (Edge, Brave, etc.)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test the extension thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE.txt for details

## Support

For issues, feature requests, or questions:

- Create an issue on GitHub
- Check existing documentation
- Review the Chrome extension development docs

---

**Note**: This extension is designed for testing and development purposes. Always ensure you have permission to test on target websites and be mindful of rate limiting and website terms of service.