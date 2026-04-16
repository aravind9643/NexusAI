import { Injectable } from '@angular/core';
import { Conversation, Folder } from '../models/chat.model';

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private dbName = 'NexusAIDB';
  private dbVersion = 1;
  private db: IDBDatabase | null = null;

  constructor() {}

  async init(): Promise<void> {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('conversations')) {
          db.createObjectStore('conversations', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('folders')) {
          db.createObjectStore('folders', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onerror = (event) => {
        console.error('IndexedDB error:', (event.target as IDBOpenDBRequest).error);
        reject('Failed to open IndexedDB');
      };
    });
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    await this.init();
    return this.performTransaction('conversations', 'readwrite', (store) => store.put(conversation));
  }

  async deleteConversation(id: string): Promise<void> {
    await this.init();
    return this.performTransaction('conversations', 'readwrite', (store) => store.delete(id));
  }

  async getAllConversations(): Promise<Conversation[]> {
    await this.init();
    return this.performTransaction<Conversation[]>('conversations', 'readonly', (store) => store.getAll());
  }

  async saveFolders(folders: Folder[]): Promise<void> {
    await this.init();
    const transaction = this.db!.transaction('folders', 'readwrite');
    const store = transaction.objectStore('folders');
    
    // Clear existing and re-add all for simplicity with small numbers of folders
    store.clear();
    folders.forEach(f => store.put(f));
    
    return new Promise((resolve) => {
      transaction.oncomplete = () => resolve();
    });
  }

  async getAllFolders(): Promise<Folder[]> {
    await this.init();
    return this.performTransaction<Folder[]>('folders', 'readonly', (store) => store.getAll());
  }

  async saveSetting(key: string, value: any): Promise<void> {
    await this.init();
    return this.performTransaction('settings', 'readwrite', (store) => store.put({ key, value }));
  }

  async getSetting<T>(key: string): Promise<T | null> {
    await this.init();
    const result = await this.performTransaction<any>('settings', 'readonly', (store) => store.get(key));
    return result ? result.value : null;
  }

  private performTransaction<T>(
    storeName: string, 
    mode: IDBTransactionMode, 
    action: (store: IDBObjectStore) => IDBRequest
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject('Database not initialized');
      
      const transaction = this.db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      const request = action(store);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}
