// Comprehensive text sanitization utility for database storage
export function sanitizeText(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  return text
    // Remove or replace problematic Unicode escape sequences
    .replace(/\\u[0-9a-fA-F]{4}/g, '') // Remove Unicode escape sequences
    .replace(/\\[nrtbfav\\"']/g, ' ') // Replace escape sequences with spaces
    .replace(/[\x00-\x1F\x7F-\x9F]/g, ' ') // Remove control characters
    .replace(/[\uFFFE\uFFFF]/g, '') // Remove non-characters
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ') // Remove additional control chars
    // Normalize Unicode to decomposed form then back to composed
    .normalize('NFD').normalize('NFC')
    // Clean up whitespace
    .replace(/\s+/g, ' ')
    .trim()
    // Ensure reasonable length
    .substring(0, 100000);
}

export function sanitizeForJson(text: string): string {
  return sanitizeText(text)
    // Additional JSON-specific cleaning
    .replace(/[\\"]/g, '') // Remove backslashes and quotes that could break JSON
    .replace(/[\r\n\t]/g, ' ') // Replace newlines and tabs with spaces
    .replace(/\u0000/g, ''); // Remove null bytes
}

export function extractTextFromPdfBuffer(buffer: ArrayBuffer): string {
  try {
    const uint8Array = new Uint8Array(buffer);
    
    // Simple PDF text extraction - look for text between stream objects
    const decoder = new TextDecoder('utf-8', { fatal: false });
    let rawText = decoder.decode(uint8Array);
    
    // Extract text content from PDF structure
    const textMatches = rawText.match(/BT\s+.*?ET/gs) || [];
    let extractedText = textMatches
      .map(match => {
        // Remove PDF operators and extract readable text
        return match
          .replace(/BT|ET|Tf|Td|TJ|Tj|'/g, ' ')
          .replace(/\d+\.?\d*\s+/g, ' ')
          .replace(/[()<>\[\]{}\/]/g, ' ');
      })
      .join(' ');

    // If no text found, try to extract any readable strings
    if (!extractedText.trim()) {
      extractedText = rawText
        .replace(/[^\x20-\x7E\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    return sanitizeText(extractedText);
  } catch (error) {
    console.error('Error extracting text from PDF buffer:', error);
    return '';
  }
}