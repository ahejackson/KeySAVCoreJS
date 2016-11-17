import * as fs from "fs";
import { createHash } from "crypto";
import KeyStore from "./key-store";
import { join } from "path";
import SaveKey from "./save-key";
import {getStampSav, pad4, pad5, getStampBv} from "./util";
import BattleVideoKey from "./battle-video-key";
import { promisify, createBuffer } from "./util";

var readdirAsync = promisify(fs.readdir),
    statAsync = promisify(fs.stat),
    openAsync = promisify(fs.open),
    readAsync = promisify(fs.read),
    writeAsync = promisify(fs.write) as (fd: number, buf: Buffer, offset: number, length: number, position: number) => Promise<void>,
    closeAsync = promisify(fs.close),
    unlink = promisify(fs.unlink);

class LazyValue<T> {
    private evaluated = false;
    private value: T;

    constructor(private fun: () => Promise<T>) {}

    async get(): Promise<T> {
        if (!this.evaluated) {
            this.value = await this.fun();
            this.evaluated = true;
        }
        return this.value;
    }

    get isInitialized() {
        return this.evaluated;
    }
}

function createNoKeyError(stamp: string, isSav: boolean) {
    var e = new Error(`No key for ${isSav ? "save" : "battle video"} with stamp ${stamp} available.`) as any;
    e.name = "NoKeyAvailableError";
    e.stamp = stamp;
    e.keyType = isSav ? "SAV" : "BV";
    return e;
}

export default class KeyStoreFileSystem implements KeyStore {
    private isScanning: boolean = false;
    private scan: Promise<void>;
    private keys: { [stamp: string]: { fd: number,
                                       name: string,
                                       isSav: boolean,
                                       key: LazyValue<{ key: BattleVideoKey|SaveKey, hash: string }> } } = {};

    constructor(private path: string) {
        this.scan = this.scanSaveDirectory(this.path);
    }

    private async scanSaveDirectory(path: string): Promise<void> {
        this.isScanning = true;
        for (let fileName of await readdirAsync(path)) {
            let stats = await statAsync(join(path, fileName));
            if (!(stats.size === 0xB4AD4 || stats.size === 0x80000 || stats.size === 0x1000)) {
                continue;
            }
            let isSav = stats.size !== 0x1000;
            let readSize = isSav ? 8 : 0x10;
            let fd = <number>(await openAsync(join(path, fileName), 'r+'));
            let buf = new Buffer(readSize);
            await readAsync(fd, buf, 0, readSize, 0);
            let stamp = (isSav ? getStampSav : getStampBv)(new Uint8Array(buf.buffer, buf.byteOffset, readSize), 0);
            if (this.keys[stamp] !== undefined) {
                continue;
            }
            this.keys[stamp] = {
                fd: fd,
                name: fileName,
                isSav: isSav,
                key: new LazyValue(async function() {
                    var size = isSav ? 0xB4AD4 : 0x1000;
                    var buf = new Buffer(size);
                    await readAsync(fd, buf, 0, stats.size, 0);
                    var ui8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
                    var hash = createHash('sha256').update(buf).digest('hex');
                    return {
                        key: isSav ? new SaveKey(ui8) : new BattleVideoKey(ui8),
                        hash: hash
                    };
                })
            }
        }
        this.isScanning = false;
    }

    private async getKey(stamp: string, isSav: boolean): Promise<SaveKey|BattleVideoKey> {
        if (this.keys[stamp] !== undefined) {
            if (this.keys[stamp].isSav === isSav) {
                return (await this.keys[stamp].key.get()).key;
            }
            throw createNoKeyError(stamp, isSav);
        } else {
            if (!this.isScanning) {
                this.scan = this.scanSaveDirectory(this.path);
            }
            await this.scan;
            if (this.keys[stamp] !== undefined && this.keys[stamp].isSav === isSav) {
                return (await this.keys[stamp].key.get()).key;
            }
            throw createNoKeyError(stamp, isSav);
        }
    }

    async getSaveKey(stamp: string): Promise<SaveKey> {
        return <Promise<SaveKey>>this.getKey(stamp, true);
    }

    async getBvKey(stamp: string): Promise<BattleVideoKey> {
        return <Promise<BattleVideoKey>>this.getKey(stamp, false);
    }

    async close() {
        for (let key in this.keys) {
            if (!this.keys.hasOwnProperty(key))
                continue;
            let lazyKey = this.keys[key];
            if (lazyKey.key.isInitialized) {
                let key = await lazyKey.key.get();
                if (key.hash !== createHash("sha256").update(createBuffer(key.key.keyData)).digest("hex")) {
                    let buf = new Buffer(key.key.keyData);
                    await writeAsync(lazyKey.fd, buf, 0, buf.length, 0);
                }
            }
            await closeAsync(lazyKey.fd);
        }
    }

    async setKey(name: string, key: BattleVideoKey|SaveKey, isSav: boolean) {
        try {
            var stamp = key.stamp;
            if (this.keys[stamp] !== undefined) {
                await closeAsync(this.keys[stamp].fd);
                await unlink(join(this.path, this.keys[stamp].name));
            }
            var buf = new Buffer(key.keyData);
            var hash = createHash("sha256").update(buf).digest("hex");
            var fd = <number>(await openAsync(join(this.path, name), "w+"));
            await writeAsync(fd, buf, 0, buf.length, 0);
            this.keys[stamp] = {
                fd: fd,
                name: name,
                isSav: isSav,
                key: new LazyValue(async function() { return { key: key, hash: hash }; })
            };
        } catch(e) {
            var e = new Error("There was an error saving the key.") as any;
            e.name = "KeySavingError";
            throw e;
        }
    }

    async setBvKey(key: BattleVideoKey) {
        await this.setKey(`BV Key - ${key.stamp.replace('/', '-')}.bin`, key, false);
    }

    async setSaveKey(key: SaveKey) {
        await this.setKey(`SAV Key - ${key.stamp.replace('/', '-')}.bin`, key, true);
    }

    async setOrMergeBvKey(key: BattleVideoKey) {
        try {
            const oldKey = await this.getBvKey(key.stamp);
            oldKey.mergeKey(key);
        } catch (e) {
            await this.setBvKey(key);
        }
    }

    async setOrMergeSaveKey(key: SaveKey) {
        try {
            const oldKey = await this.getSaveKey(key.stamp);
            oldKey.mergeKey(key);
        } catch (e) {
            await this.setSaveKey(key);
        }
    }
}
