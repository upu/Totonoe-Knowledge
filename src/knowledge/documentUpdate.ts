export interface ProposedDocumentUpdate {
  path: string;
  expectedContent: string;
  proposedContent: string;
  reason: string;
}
