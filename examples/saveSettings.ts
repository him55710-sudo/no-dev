// Read the success, error-handling and cleanup paths in order.
// Injected callbacks are not executed by Pureobom's analyzer.
export async function saveSettings(
  persist: () => Promise<void>,
  showError: (error: unknown) => void,
  setSaving: (saving: boolean) => void,
) {
  setSaving(true);
  try {
    await persist();
    return "saved";
  } catch (error) {
    showError(error);
    return "failed";
  } finally {
    setSaving(false);
  }
}
