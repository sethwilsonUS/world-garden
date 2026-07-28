type AccountDeletionIndexBuilder = {
  eq: (field: string, value: unknown) => AccountDeletionIndexBuilder;
};

export const createAccountDeletionQueryChain = (
  deletingViewerTokenIdentifiers: readonly string[] = [],
) => ({
  withIndex: (
    indexName: string,
    build: (query: AccountDeletionIndexBuilder) => unknown,
  ) => {
    if (indexName !== "by_viewerTokenIdentifier") {
      throw new Error(`Unexpected account deletion index ${indexName}`);
    }

    const filters = new Map<string, unknown>();
    const query: AccountDeletionIndexBuilder = {
      eq: (field, value) => {
        filters.set(field, value);
        return query;
      },
    };
    build(query);

    const viewerTokenIdentifier = filters.get("viewerTokenIdentifier");
    return {
      first: async () =>
        typeof viewerTokenIdentifier === "string" &&
        deletingViewerTokenIdentifiers.includes(viewerTokenIdentifier)
          ? { _id: "deletion-1", viewerTokenIdentifier }
          : null,
    };
  },
});
