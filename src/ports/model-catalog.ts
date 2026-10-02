export interface ModelOption {
  readonly slug: string;
  readonly displayName: string;
}

/** Models a user's ChatGPT plan can run, in the server's preferred order. */
export interface ModelCatalog {
  list(userId: number): Promise<ModelOption[]>;
}
