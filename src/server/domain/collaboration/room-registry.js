export class RoomRegistry {
  constructor({ createRoom }) {
    this.createRoom = createRoom;
    this.rooms = new Map();
  }

  get(name) {
    return this.rooms.get(name);
  }

  getOrCreate(name) {
    if (!this.rooms.has(name)) {
      const room = this.createRoom({
        name,
        onEmpty: (roomName) => {
          this.rooms.delete(roomName);
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

  async reset() {
    await Promise.allSettled(
      Array.from(this.rooms.values(), (room) => room.destroy?.()),
    );
    this.rooms.clear();
  }
}
