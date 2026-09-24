export interface RuleConstraint {
  /**
   * Id of the constraint. Built-in constraints have negative ids
   */
  id?: number;
  /**
   * Name of the constraint
   */
  name?: string;
  /**
   * Data type of the constraint value
   */
  dataType?: string;
  /**
   * Whether this is the primary constraint of the rule type
   */
  primary?: boolean;
  /**
   * Default operator of the constraint
   */
  operator?: string;
  /**
   * Whether the constraint is a person or company field
   */
  dbAttrib?: boolean;
  /**
   * Id of the person or company field
   */
  dbAttribId?: string;
  /**
   * Object the field belongs to
   */
  dbObject?: string;
  /**
   * Field type of the constraint, for example standard or custom
   */
  type?: string;
}
