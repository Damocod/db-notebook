import ShortUniqueId from "short-unique-id";
import {
  ConnectionSetting,
  DBDriverResolver,
  DbDatabase,
  DbLogGroup,
  DbS3Bucket,
  DbSQSQueue,
  DbSchema,
  ResourceType,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ExtensionContext, SecretStorage } from "vscode";
import { EXTENSION_NAME } from "../constant";
import { log } from "./logger";

const uid = new ShortUniqueId();

const PREFIX = "[StateStorage]";

export const STORAGE_KEY = `${EXTENSION_NAME}-settings`;

type DbResInfo = {
  isInProgress: boolean;
  res?: DbDatabase[];
};

export const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

export class StateStorage {
  private resMap = new Map<string, DbResInfo>();

  getResourceByName(connectionName: string): DbDatabase[] | undefined {
    if (this.resMap.has(connectionName)) {
      return this.resMap.get(connectionName)?.res;
    }
    return undefined;
  }

  async loadResource(
    connectionName: string,
    force: boolean,
    wait = false
  ): Promise<DbDatabase[] | undefined> {
    const conRes = await this.getConnectionSettingByName(connectionName);
    if (!conRes) {
      return;
    }
    let resInfo = this.resMap.get(connectionName);
    if (resInfo?.res && !force) {
      return resInfo?.res;
    }
    if (resInfo?.isInProgress) {
      if (!wait) {
        return;
      }
      for (let i = 0; i < 60 && resInfo?.isInProgress; i++) {
        await sleep(500);
        resInfo = this.resMap.get(connectionName);
      }
      return resInfo?.res;
    }
    if (!resInfo) {
      resInfo = {
        isInProgress: true,
      };
      this.resMap.set(connectionName, resInfo);
    }

    const { ok, message, result } = await DBDriverResolver.getInstance().workflow(
      conRes,
      async (driver) => await driver.getInfomationSchemas()
    );

    if (ok && result) {
      for (const dbRes of result) {
        dbRes.meta = {
          conName: conRes.name,
        };
        // for rds
        dbRes.findChildren<DbSchema>({ resourceType: ResourceType.Schema }).forEach((schemaRes) => {
          schemaRes.children.forEach((tableRes) => {
            tableRes.meta = {
              conName: conRes.name,
              schemaName: schemaRes.name,
            };
          });
        });
        // for aws resource ---------
        // for s3
        dbRes.findChildren<DbS3Bucket>({ resourceType: ResourceType.Bucket }).forEach((bucket) => {
          bucket.meta = {
            conName: conRes.name,
          };
        });
        // for sqs
        dbRes.findChildren<DbSQSQueue>({ resourceType: ResourceType.Queue }).forEach((queueRes) => {
          queueRes.meta = {
            conName: conRes.name,
          };
        });
        // for cloudwatch
        dbRes
          .findChildren<DbLogGroup>({ resourceType: ResourceType.LogGroup })
          .forEach((logGroupRes) => {
            logGroupRes.meta = {
              conName: conRes.name,
            };
          });
      }
      this.resMap.set(connectionName, { isInProgress: false, res: result });
      return result;
    } else {
      this.resMap.set(connectionName, { isInProgress: false, res: undefined });
      throw new Error(message);
    }
  }

  constructor(private context: ExtensionContext, private secretStorage: SecretStorage) {}

  async getConnectionSettingList(): Promise<ConnectionSetting[]> {
    const list = this.context.globalState.get<ConnectionSetting[]>(STORAGE_KEY, []);
    console.log("L122", list);
    for (const it of list) {
      if (it.id) {
        it.password = await this.getSecret(it.id);
      }
    }
    return list;
  }

  async getConnectionSettingByName(name: string): Promise<ConnectionSetting | undefined> {
    const list = this.context.globalState.get<ConnectionSetting[]>(STORAGE_KEY, []);
    const setting = list.find((it) => it.name === name);
    if (setting) {
      if (setting.id) {
        setting.password = await this.getSecret(setting.id);
      }
      return setting;
    }
    return undefined;
  }

  getConnectionSettingNames(): string[] {
    const list = this.context.globalState.get<ConnectionSetting[]>(STORAGE_KEY, []);
    return list.map((it) => it.name);
  }

  hasConnectionSettingByName(name: string): boolean {
    const list = this.context.globalState.get<ConnectionSetting[]>(STORAGE_KEY, []);
    return list.some((it) => it.name === name);
  }

  async addConnectionSetting(setting: ConnectionSetting): Promise<boolean> {
    const list = await this.getConnectionSettingList();
    if (list.some((it) => it.name === setting.name)) {
      return false;
    }
    if (setting.id === undefined || setting.id === null || setting.id === "") {
      setting.id = uid.randomUUID(8);
    }
    await this.removePasswordAndStoreOnSecret(setting);
    list.push(setting);
    this.context.globalState.update(STORAGE_KEY, list);
    return true;
  }

  async editConnectionSetting(setting: ConnectionSetting): Promise<boolean> {
    const list = await this.getConnectionSettingList();
    const idx = list.findIndex((it) => it.name === setting.name);
    if (idx < 0) {
      return false;
    }
    if (setting.id === undefined || setting.id === null || setting.id === "") {
      setting.id = uid.randomUUID(8);
    }
    await this.removePasswordAndStoreOnSecret(setting);

    list.splice(idx, 1, setting);
    this.context.globalState.update(STORAGE_KEY, list);

    return true;
  }

  async deleteConnectionSetting(name: string): Promise<boolean> {
    log(`${PREFIX} deleteConnectionSetting name:[${name}]`);
    const list = await this.getConnectionSettingList();
    const idx = list.findIndex((it) => it.name === name);
    if (idx < 0) {
      return false;
    }
    const removed = list.splice(idx, 1);
    if (removed && removed[0].password) {
      await this.deleteSecret(removed[0].password);
    }
    this.context.globalState.update(STORAGE_KEY, list);
    this.resMap.delete(name);
    return true;
  }

  private async removePasswordAndStoreOnSecret(setting: ConnectionSetting): Promise<void> {
    if (setting.id && setting.password) {
      await this.storeSecret(setting.id, setting.password);
    }
    setting.password = undefined;
  }

  private async getSecret(key: string): Promise<string | undefined> {
    return await this.secretStorage.get(key);
  }

  private async storeSecret(key: string, value: string): Promise<void> {
    await this.secretStorage.store(key, value);
  }

  private async deleteSecret(key: string): Promise<void> {
    await this.secretStorage.delete(key);
  }
}
