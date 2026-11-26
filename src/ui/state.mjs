// Full snapshots are ordered by revision; runtime notifications are partial.
export function createUIState() {
  let snapshot,
    error = "";
  return {
    get: () => snapshot,
    activeTab: () => snapshot?.tabs.find((tab) => tab.id === snapshot.activeId),
    accept(next) {
      if (snapshot && next.revision < snapshot.revision) return false;
      snapshot = next;
      return true;
    },
    mergeRuntime(value) {
      if (!snapshot) return false;
      snapshot = { ...snapshot, ...value };
      return true;
    },
    getError: () => error,
    setError: (message) => {
      error = message;
    },
  };
}
