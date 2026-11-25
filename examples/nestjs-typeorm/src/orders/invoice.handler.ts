import { Injectable, Logger } from '@nestjs/common';
import { Order } from './order.entity';

export interface InvoiceLine {
  label: string;
  amount: number;
}

@Injectable()
export class InvoiceHandler {
  private readonly logger = new Logger(InvoiceHandler.name);

  build(orders: Order[], discount: number): { lines: InvoiceLine[]; total: number } {
    const lines = orders.map((o) => ({ label: `Order #${o.id}`, amount: this.applyDiscount(o.amount, discount) }));
    const total = +lines.reduce((s, l) => s + l.amount, 0).toFixed(2);
    console.log('invoice built', { lines: lines.length, total });
    return { lines, total };
  }

  applyDiscount(amount: number, discount: number) {
    return +(amount * (1 - discount)).toFixed(2);
  }
}
