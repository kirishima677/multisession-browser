const { expect } = require("./electron");

async function captureContextMenus(application) {
  await application.evaluate(({ Menu }) => {
    const popup = Menu.prototype.popup;
    Menu.prototype.popup = function (options) {
      global.__actionMenu = this;
      return popup.call(this, options);
    };
  });
}

async function contextClick(application, page, locator, id) {
  await locator.click({ button: "right" });
  await expect
    .poll(() =>
      application.evaluate(
        (_electron, id) => Boolean(global.__actionMenu?.getMenuItemById(id)),
        id,
      ),
    )
    .toBe(true);
  await application.evaluate((_electron, id) => {
    const menu = global.__actionMenu;
    menu.closePopup();
    menu.getMenuItemById(id).click();
  }, id);
}

module.exports = { captureContextMenus, contextClick };
