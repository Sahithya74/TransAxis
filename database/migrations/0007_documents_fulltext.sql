-- Keyword half of the assistant's hybrid search; the vector half lives in Qdrant. InnoDB's built-in
-- parser keeps codes such as "TN04FM1945" or "9965" as whole tokens.
ALTER TABLE `document_chunks` ADD FULLTEXT INDEX `ft_document_chunks_content` (`content`);
