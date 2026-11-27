export declare const schema: { $defs: Record<string, { properties?: Record<string, unknown>; required?: string[] }> };
export declare function validate(value: unknown, def?: string): string[];
