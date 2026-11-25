import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  async getById(id: number): Promise<User> {
    const user = await this.users.findOne({ where: { id }, relations: { orders: true } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  discountFor(user: User): number {
    return { gold: 0.15, silver: 0.05 }[user.tier] ?? 0;
  }
}
