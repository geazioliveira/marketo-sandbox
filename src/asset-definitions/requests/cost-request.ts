export interface CostRequest {
  /**
   * Amount of the cost
   */
  cost: number;
  /**
   * Notes on the cost
   */
  note?: string;
  /**
   * Start date of the period cost
   */
  startDate: string;
}
