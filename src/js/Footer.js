/**
 * Renders a minimal footer into every section's footer slot.
 * @param {HTMLElement} container
 */
export function renderFooter(container) {
  const footer = document.createElement("footer");
  footer.className = "footer";
  footer.innerHTML = `&copy; James Buckhouse. Portfolio restyle using macOS Big Sur visual language.`;
  container.appendChild(footer);
}
