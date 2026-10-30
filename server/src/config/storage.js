const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

class JsonStore {
  constructor(filename) {
    this.filepath = path.join(DATA_DIR, `${filename}.json`);
    if (!fs.existsSync(this.filepath)) {
      fs.writeFileSync(this.filepath, JSON.stringify([], null, 2));
    }
  }

  read() {
    try {
      const data = fs.readFileSync(this.filepath, 'utf8');
      return JSON.parse(data || '[]');
    } catch (e) {
      return [];
    }
  }

  write(data) {
    fs.writeFileSync(this.filepath, JSON.stringify(data, null, 2));
  }

  find(query = {}) {
    const items = this.read();
    return items.filter(item => {
      return Object.keys(query).every(key => item[key] === query[key]);
    });
  }

  findOne(query = {}) {
    const items = this.read();
    return items.find(item => {
      return Object.keys(query).every(key => item[key] === query[key]);
    }) || null;
  }

  findById(id) {
    const items = this.read();
    return items.find(item => item._id === id || item.id === id) || null;
  }

  create(doc) {
    const items = this.read();
    const newDoc = {
      _id: doc._id || 'id_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
      ...doc,
      createdAt: doc.createdAt || new Date().toISOString(),
      updatedAt: doc.updatedAt || new Date().toISOString()
    };
    items.push(newDoc);
    this.write(items);
    return newDoc;
  }

  findByIdAndUpdate(id, update, options = { new: true }) {
    const items = this.read();
    const index = items.findIndex(item => item._id === id || item.id === id);
    if (index === -1) return null;

    const existing = items[index];
    const updated = {
      ...existing,
      ...update,
      updatedAt: new Date().toISOString()
    };
    items[index] = updated;
    this.write(items);
    return updated;
  }

  findByIdAndDelete(id) {
    const items = this.read();
    const index = items.findIndex(item => item._id === id || item.id === id);
    if (index === -1) return null;
    const removed = items.splice(index, 1)[0];
    this.write(items);
    return removed;
  }

  deleteMany(query = {}) {
    let items = this.read();
    const initialLen = items.length;
    items = items.filter(item => {
      return !Object.keys(query).every(key => item[key] === query[key]);
    });
    this.write(items);
    return { deletedCount: initialLen - items.length };
  }
}

module.exports = {
  usersStore: new JsonStore('users'),
  booksStore: new JsonStore('books'),
  notesStore: new JsonStore('notes'),
  chatsStore: new JsonStore('chats'),
  recommendationsStore: new JsonStore('recommendations'),
  recommendationFeedbackStore: new JsonStore('recommendationFeedback')
};
