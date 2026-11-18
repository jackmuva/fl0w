/** Whether this run is inside the fl0w-work remote sandbox, where files are opened through fl0w-work links. */
class RemoteStore {
  private enabled = false;

  get(): boolean {
    return this.enabled;
  }

  set(enabled: boolean): void {
    this.enabled = enabled;
  }
}

export const remoteStore = new RemoteStore();
