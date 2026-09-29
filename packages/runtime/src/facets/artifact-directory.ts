import type { BusinessContext, PublicationReceipt } from "../answering/public.js";

export interface PublishedArtifactSummary {
  readonly publicationId: string;
  readonly taskId: string;
  readonly candidateId: string;
  readonly format: "inline" | "csv";
  readonly contentHash: string;
  readonly publicRef: string;
}

export interface AuthorizedArtifact {
  readonly summary: PublishedArtifactSummary;
  readonly content: string;
}

export interface AuthorizedPublicationSql {
  readonly receiptId: string;
  readonly candidateId: string;
  readonly queryHash: string;
  readonly sql: string;
}

export interface ArtifactReadModel {
  findPublication(publicationId: string, context: BusinessContext): Promise<PublicationReceipt | undefined>;
  readAuthorized(receipt: PublicationReceipt, context: BusinessContext): Promise<{ readonly content: string; readonly contentHash: string }>;
  /** Optional authorized SQL projection; it must resolve through the Receipt. */
  readSqlAuthorized?(receipt: PublicationReceipt, context: BusinessContext): Promise<{ readonly sql: string; readonly queryHash: string }>;
  /** Optional typed rows of the published result; it must resolve through the Receipt. */
  readRowsAuthorized?(receipt: PublicationReceipt, context: BusinessContext): Promise<PublishedRows>;
}

/** Published rows with their original types (numbers, bigints, NULL), as charts need them. */
export interface PublishedRows {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
  readonly contentHash: string;
}

export interface AuthorizedPublishedRows extends Omit<PublishedRows, "contentHash"> {
  readonly receipt: PublicationReceipt;
}

/**
 * Presentation-facing artifact directory. It resolves through a Receipt and
 * never exposes a ResultStore path or accepts a guessed filename.
 */
export class ArtifactDirectory {
  constructor(private readonly source: ArtifactReadModel) {}

  async resolveSql(publicationId: string, context: BusinessContext): Promise<AuthorizedPublicationSql> {
    const receipt = await this.source.findPublication(publicationId, context);
    if (!receipt) throw new Error("PUBLICATION_NOT_FOUND");
    if (!this.source.readSqlAuthorized) throw new Error("PUBLICATION_SQL_PROJECTION_UNAVAILABLE");
    const projected = await this.source.readSqlAuthorized(receipt, context);
    if (!projected.sql.trim() || !projected.queryHash) throw new Error("PUBLICATION_SQL_INTEGRITY_MISMATCH");
    return { receiptId: receipt.receiptId, candidateId: receipt.candidateId, queryHash: projected.queryHash, sql: projected.sql };
  }

  async resolve(publicationId: string, context: BusinessContext): Promise<AuthorizedArtifact> {
    const receipt = await this.source.findPublication(publicationId, context);
    if (!receipt) throw new Error("PUBLICATION_NOT_FOUND");
    const encoded = await this.source.readAuthorized(receipt, context);
    if (!receipt.presentationContentHash || encoded.contentHash !== receipt.presentationContentHash) throw new Error("PUBLICATION_INTEGRITY_MISMATCH");
    return {
      summary: {
        publicationId: receipt.receiptId,
        taskId: receipt.taskId,
        candidateId: receipt.candidateId,
        format: receipt.format,
        contentHash: receipt.contentHash,
        publicRef: receipt.publicRef,
      },
      content: encoded.content,
    };
  }

  /** Typed rows of one publication, checked against the Receipt's content hash. */
  async resolveRows(publicationId: string, context: BusinessContext): Promise<AuthorizedPublishedRows> {
    const receipt = await this.source.findPublication(publicationId, context);
    if (!receipt) throw new Error("PUBLICATION_NOT_FOUND");
    if (!this.source.readRowsAuthorized) throw new Error("PUBLICATION_ROWS_PROJECTION_UNAVAILABLE");
    const published = await this.source.readRowsAuthorized(receipt, context);
    if (published.contentHash !== receipt.contentHash) throw new Error("PUBLICATION_INTEGRITY_MISMATCH");
    return { receipt, columns: published.columns, rows: published.rows };
  }
}
