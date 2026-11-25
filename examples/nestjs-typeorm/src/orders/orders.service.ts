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
