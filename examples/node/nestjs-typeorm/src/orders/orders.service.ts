import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsersService } from '../users/users.service';
import { InvoiceHandler } from './invoice.handler';
import { Order } from './order.entity';

export class CreateOrderDto {
  userId: number;
  amount: number;
}

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly users: UsersService,
    private readonly invoices: InvoiceHandler,
  ) {}

  async invoiceFor(userId: number) {
    const user = await this.users.getById(userId);
    const paid = await this.orders.find({ where: { user: { id: userId }, status: 'paid' } });
    return { user: user.name, ...this.invoices.build(paid, this.users.discountFor(user)) };
  }

  async create(dto: CreateOrderDto) {
    if (!(dto.amount > 0)) throw new BadRequestException('amount must be > 0');
    const user = await this.users.getById(dto.userId);
    const order = this.orders.create({ user, amount: dto.amount, status: 'pending' });
    return this.orders.save(order);
  }

  /**
   * Re-check every order: loads each one with its own query (an N+1 on purpose, to show how
   * StackLens folds repeated calls and their SQL), prices it and runs a risk check.
   */
  async audit(limit = 300) {
    const ids = await this.orders.find({ select: { id: true }, order: { id: 'ASC' }, take: limit });
    let total = 0;
    const flagged: number[] = [];
    for (const { id } of ids) {
      const order = await this.orders.findOne({ where: { id }, relations: { user: true } });
      if (!order) continue;
      total += this.invoices.applyDiscount(order.amount, this.users.discountFor(order.user));
      try {
        this.assessRisk(order);
      } catch {
        flagged.push(order.id);
      }
    }
    return { checked: ids.length, total: +total.toFixed(2), flagged: flagged.length, sample: flagged.slice(0, 5) };
  }

  assessRisk(order: Order) {
    if (order.status === 'refunded' && order.amount > 1000) {
      throw new BadRequestException(`Order ${order.id}: refund of ${order.amount} needs review`);
    }
    return 'ok';
  }

  async stats() {
    return this.orders
      .createQueryBuilder('o')
      .select('o.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(o.amount)', 'sum')
      .groupBy('o.status')
      .getRawMany();
  }
}
