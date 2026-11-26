function installBrowserIPC({ ipcMain, getWindow, shellURL, command, publish }) {
  let mutation = false;

  ipcMain.handle("browser:command", async (event, action, p) => {
    const win = getWindow();
    if (
      !win ||
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame ||
      event.senderFrame.url !== shellURL
    )
      throw new Error("許可されていない操作です。");
    if (mutation && action !== "state")
      return { error: "処理中です。完了後にもう一度お試しください。" };
    if (action !== "state") mutation = true;
    try {
      return await command(action, p);
    } catch (error) {
      publish();
      return { error: error.message };
    } finally {
      if (action !== "state") mutation = false;
    }
  });
}

module.exports = { installBrowserIPC };
