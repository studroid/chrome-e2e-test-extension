# E2E Test Recorder - Chrome Extension

Chrome extension for simplified end-to-end testing. Easily record, replay, and manage E2E test scenarios directly in your browser with automated element selection and test generation capabilities.

## Features

- **🎥 Record User Interactions**: Automatically capture clicks, inputs, form submissions, and navigation
- **🔄 Replay Tests**: Execute recorded test scenarios with visual feedback
- **🎯 Smart Element Selection**: Intelligent selector generation for reliable element targeting
- **📊 Test Management**: Organize, export, and manage multiple test scenarios
- **📝 Code Generation**: Export tests as Playwright, Cypress, or Selenium code
- **⚡ Real-time Feedback**: Visual indicators during recording and replay

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

The extension captures the following user interactions:

- **Clicks**: Button clicks, link navigation, checkbox/radio selections
- **Text Input**: Form field entries, text area content
- **Selections**: Dropdown menu choices
- **Keyboard Events**: Enter key, Tab navigation
- **Page Navigation**: URL changes and redirects

## Technical Details

### Architecture

- **Manifest V3**: Uses the latest Chrome extension architecture
- **Content Script**: Handles page interaction recording and replay
- **Background Script**: Manages data storage and cross-tab communication
- **Popup Interface**: Provides user controls for test management

### Selector Strategy

The extension uses an intelligent selector hierarchy:

1. Element ID (`#elementId`)
2. Unique class combinations (`.class1.class2`)
3. Data attributes (`[data-testid="value"]`)
4. Name attributes (`[name="fieldName"]`)
5. CSS path fallback (`div > span:nth-of-type(2)`)

### Storage

- Tests are stored locally using Chrome's storage API
- No data is transmitted to external servers
- Export functionality allows backup and sharing

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