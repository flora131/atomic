/**
 * HotlineEmbed component.
 * Creates the Delphi.ai iframe wrapper for the 24-Hour Hotline section.
 */

const DELPHI_URL = 'https://www.delphi.ai/buckhouse';

// TODO: Implement responsive sizing and loading state
export function createHotlineEmbed() {
  const wrapper = document.createElement('div');
  wrapper.className = 'hotline-embed';

  const iframe = document.createElement('iframe');
  iframe.src = DELPHI_URL;
  iframe.title = 'James Buckhouse - 24-Hour Story, Art & Design Hotline';
  iframe.allow = 'microphone; camera';
  iframe.setAttribute('allowfullscreen', '');
  wrapper.appendChild(iframe);

  return wrapper;
}

export default createHotlineEmbed;
