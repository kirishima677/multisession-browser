export const $ = (selector) => document.querySelector(selector);

export function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function button(text, cls, handler, title) {
  const node = el("button", cls, text);
  node.type = "button";
  if (title) {
    node.title = title;
    node.setAttribute("aria-label", title);
  }
  node.addEventListener("click", handler);
  return node;
}
export function dot(color) {
  const node = el("span", "dot");
  node.style.setProperty("--color", color);
  return node;
}
export function field(parent, name, value = "", help) {
  const id = `field-${name}`;
  const caption = el("label", "", name);
  caption.htmlFor = id;
  const input = el("input");
  input.id = id;
  input.value = value;
  input.maxLength = 80;
  input.required = true;
  parent.append(caption, input);
  if (help) parent.append(el("p", "help", help));
  return input;
}
