import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { User } from './users/user.entity';
import { Order } from './orders/order.entity';
import { UsersModule } from './users/users.module';
import { OrdersModule } from './orders/orders.module';

@Module({
  imports: [TypeOrmModule.forRoot({ type: 'sqljs', entities: [User, Order], synchronize: true }), UsersModule, OrdersModule],
})
export class AppModule implements OnApplicationBootstrap {
  constructor(private readonly ds: DataSource) {}
  async onApplicationBootstrap() {
    const users = this.ds.getRepository(User);
    const orders = this.ds.getRepository(Order);
    const [ada, alan] = await users.save([
      { name: 'Ada Lovelace', email: 'ada@example.com', tier: 'gold' },
      { name: 'Alan Turing', email: 'alan@example.com', tier: 'silver' },
    ]);
    await orders.save([
      { user: ada, amount: 120.5, status: 'paid' },
      { user: ada, amount: 42, status: 'pending' },
      { user: alan, amount: 9.99, status: 'paid' },
    ]);
    // bulk data for GET /orders/audit (one query per order – an N+1 on purpose)
    const more = await users.save(
      Array.from({ length: 20 }, (_, i) => ({
        name: `Customer ${i + 3}`,
        email: `c${i + 3}@example.com`,
        tier: ['gold', 'silver', 'basic'][i % 3],
      })),
    );
    const everyone = [ada, alan, ...more];
    await orders.save(
      Array.from({ length: 300 }, (_, i) => ({
        user: everyone[i % everyone.length],
        amount: +(5 + ((i * 37) % 1200) + (i % 7) / 10).toFixed(2),
        status: ['paid', 'pending', 'refunded'][i % 3],
      })),
    );
  }
}
