import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../users/user.entity';

@Entity()
export class Order {
  @PrimaryGeneratedColumn() id: number;
  @ManyToOne(() => User, (u) => u.orders, { eager: false }) user: User;
  @Column('float') amount: number;
  @Column() status: string;
  @CreateDateColumn() createdAt: Date;
}
