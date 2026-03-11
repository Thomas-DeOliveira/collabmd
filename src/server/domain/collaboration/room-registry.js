export class RoomRegistry {
  constructor({ createRoom }) {
    this.createRoom = createRoom;
    this.rooms = new Map();
  }

  get(name) {
    return this.rooms.get(name);
  }

  getOrCreate(name) {
    const existingRoom = this.rooms.get(name);
    if (!existingRoom || existingRoom.isDeleted?.()) {
      const room = this.createRoom({
        name,
        onEmpty: (roomName) => {
          if (this.rooms.get(roomName) === room) {
            this.rooms.delete(roomName);
          }
        },
      });

      this.rooms.set(name, room);
    }

    return this.rooms.get(name);
  }

  rename(oldName, newName) {
    if (!oldName || !newName || oldName === newName) {
      return false;
    }

    const room = this.rooms.get(oldName);
    if (!room) {
      return false;
    }

    if (this.rooms.has(newName)) {
      return false;
    }

    this.rooms.delete(oldName);
    room.rename?.(newName);
    this.rooms.set(newName, room);
    return true;
  }

  delete(name) {
    return this.rooms.delete(name);
  }

  async reset() {
    await Promise.allSettled(
      Array.from(this.rooms.values(), (room) => room.destroy?.()),
    );
    this.rooms.clear();
  }

  async reconcileWorkspaceChange(workspaceChange = {}) {
    const deletedPaths = new Set(workspaceChange.deletedPaths ?? []);
    const renamedPaths = Array.isArray(workspaceChange.renamedPaths) ? workspaceChange.renamedPaths : [];
    const renamedOldPaths = new Set(renamedPaths.map((entry) => entry?.oldPath).filter(Boolean));

    await Promise.allSettled(
      [...deletedPaths, ...renamedOldPaths].map(async (pathValue) => {
        const room = this.rooms.get(pathValue);
        if (!room) {
          return;
        }

        room.markDeleted?.();
        await room.destroy?.();
        if (this.rooms.get(pathValue) === room) {
          this.rooms.delete(pathValue);
        }
      }),
    );

    const blockedPaths = new Set([...deletedPaths, ...renamedOldPaths]);
    await Promise.allSettled(
      Array.from(new Set(workspaceChange.changedPaths ?? []))
        .filter((pathValue) => pathValue && !blockedPaths.has(pathValue))
        .map(async (pathValue) => {
          const room = this.rooms.get(pathValue);
          if (!room || room.isDeleted?.()) {
            return;
          }

          await room.reloadFromDisk?.();
        }),
    );
  }
}
