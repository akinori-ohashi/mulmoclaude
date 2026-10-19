export interface Messages {
  untitled: string;
  chartCount(count: number): string;
  chartTitle(num: number): string;
  png: string;
  fromSpreadsheet(range: string): string;
  notLinked: string;
  unreadableSource: string;
  sourceTimedOut: string;
}
