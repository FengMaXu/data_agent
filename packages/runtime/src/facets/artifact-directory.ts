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

export interface ArtifactReadModel {
  findPublication(publicationId: string, context: BusinessContext): Promise<PublicationReceipt | undefined>;
  readAuthorized(receipt: PublicationReceipt, context: BusinessContext): Promise<{ readonly content: string; readonly contentHash: string }>;
}

/**
 * Presentation-facing artifact directory. It resolves through a Receipt and
 * never exposes a ResultStore path or accepts a guessed filename.
 */
export class ArtifactDirectory {
  constructor(private readonly source: ArtifactReadModel) {}

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
}
