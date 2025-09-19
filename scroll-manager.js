class ScrollManager {
  static getAllScrollableElements() {
    const scrollableElements = [];

    // Always include window/document scroll position
    scrollableElements.push({
      element: 'window',
      scrollLeft: window.pageXOffset || document.documentElement.scrollLeft || document.body.scrollLeft || 0,
      scrollTop: window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0
    });

    // Find all scrollable elements in the DOM
    const allElements = document.querySelectorAll('*');
    allElements.forEach(element => {
      const style = getComputedStyle(element);
      const hasScrollableContent = (
        element.scrollHeight > element.clientHeight ||
        element.scrollWidth > element.clientWidth
      );
      const isScrollable = (
        style.overflow === 'auto' ||
        style.overflow === 'scroll' ||
        style.overflowX === 'auto' ||
        style.overflowX === 'scroll' ||
        style.overflowY === 'auto' ||
        style.overflowY === 'scroll'
      );

      if (hasScrollableContent && isScrollable && (element.scrollLeft > 0 || element.scrollTop > 0)) {
        scrollableElements.push({
          element: element,
          scrollLeft: element.scrollLeft,
          scrollTop: element.scrollTop,
          selector: this.getElementSelector(element)
        });
      }
    });

    console.log(`📍 Found ${scrollableElements.length} scrollable elements with positions`);
    return scrollableElements;
  }

  static getElementSelector(element) {
    if (element.id) {
      return `#${element.id}`;
    }
    if (element.className) {
      const classes = element.className.split(' ').filter(c => c.trim()).slice(0, 2);
      if (classes.length > 0) {
        return `${element.tagName.toLowerCase()}.${classes.join('.')}`;
      }
    }
    return element.tagName.toLowerCase();
  }

  static saveScrollPositions() {
    const positions = this.getAllScrollableElements();
    console.log('💾 Saved scroll positions:', positions);
    return positions;
  }

  static restoreScrollPositions(savedPositions) {
    if (!savedPositions || !Array.isArray(savedPositions)) {
      console.warn('⚠️ No valid scroll positions to restore');
      return;
    }

    console.log('🔄 Restoring scroll positions:', savedPositions);

    savedPositions.forEach(pos => {
      try {
        if (pos.element === 'window') {
          // Restore window scroll position using multiple methods
          window.scrollTo(pos.scrollLeft, pos.scrollTop);
          document.documentElement.scrollLeft = pos.scrollLeft;
          document.documentElement.scrollTop = pos.scrollTop;
          document.body.scrollLeft = pos.scrollLeft;
          document.body.scrollTop = pos.scrollTop;
        } else if (pos.selector) {
          // Try to find and restore element scroll position
          const elements = document.querySelectorAll(pos.selector);
          elements.forEach(element => {
            if (element.scrollLeft !== undefined && element.scrollTop !== undefined) {
              element.scrollLeft = pos.scrollLeft;
              element.scrollTop = pos.scrollTop;
            }
          });
        } else if (pos.element && pos.element.scrollLeft !== undefined) {
          // Direct element reference (if still valid)
          pos.element.scrollLeft = pos.scrollLeft;
          pos.element.scrollTop = pos.scrollTop;
        }
      } catch (error) {
        console.warn('⚠️ Failed to restore scroll position for element:', pos, error);
      }
    });
  }
}

// Export for use in Chrome extension
window.ScrollManager = ScrollManager;