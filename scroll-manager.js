class ScrollManager {
  static saveScrollPositions() {
    const savedScrollData = [];

    // 모든 스크롤 가능한 요소 찾아서 저장
    document.querySelectorAll('*').forEach((el) => {
      if (el.scrollTop > 0 || el.scrollHeight > el.clientHeight) {
        savedScrollData.push({
          element: el,
          scrollTop: el.scrollTop,
          scrollLeft: el.scrollLeft,
          selector: this.getElementSelector(el)
        });
      }
    });

    console.log('💾 Saved scroll positions:', savedScrollData);
    return savedScrollData;
  }

  static restoreScrollPositions(savedScrollData) {
    if (!savedScrollData || !Array.isArray(savedScrollData)) {
      console.warn('⚠️ No valid scroll positions to restore');
      return;
    }

    console.log('🔄 Restoring scroll positions:', savedScrollData);

    savedScrollData.forEach(data => {
      try {
        // 요소가 여전히 존재하는지 확인
        if (data.element && data.element.isConnected) {
          data.element.scrollTop = data.scrollTop;
          data.element.scrollLeft = data.scrollLeft;
        } else {
          // selector로 다시 찾아서 복원
          const element = document.querySelector(data.selector);
          if (element) {
            element.scrollTop = data.scrollTop;
            element.scrollLeft = data.scrollLeft;
          }
        }
      } catch (e) {
        console.warn('⚠️ Failed to restore scroll for element:', data, e);
      }
    });
  }

  // 요소 선택자 생성 (고유 식별을 위해)
  static getElementSelector(element) {
    if (element.id) return `#${element.id}`;
    if (element.className) return `.${element.className.split(' ')[0]}`;

    const path = [];
    let currentElement = element;
    while (currentElement.parentNode) {
      let selector = currentElement.nodeName.toLowerCase();
      if (currentElement.id) {
        selector += `#${currentElement.id}`;
        path.unshift(selector);
        break;
      } else {
        const siblings = currentElement.parentNode.children;
        const index = Array.from(siblings).indexOf(currentElement) + 1;
        selector += `:nth-child(${index})`;
      }
      path.unshift(selector);
      currentElement = currentElement.parentNode;
    }
    return path.join(' > ');
  }
}

// Export for use in Chrome extension
window.ScrollManager = ScrollManager;