export const DBType = {
  MySQL: "MySQL",
  Postgres: "Postgres",
  Redis: "Redis",
  Keycloak: "Keycloak",
  Aws: "Aws",
} as const;

export type DBType = (typeof DBType)[keyof typeof DBType];

export const DBTypeValues = Object.values(DBType);

export const isAws = (dbType: DBType): boolean => DBType.Aws === dbType;

export const isIam = (dbType: DBType): boolean => DBType.Keycloak === dbType;

export const isRDSType = (dbType: DBType): boolean => {
  switch (dbType) {
    case DBType.MySQL:
    case DBType.Postgres:
      return true;
  }
  return false;
};
