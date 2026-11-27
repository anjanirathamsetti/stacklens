import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { CreateOrderDto, OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('stats')
  stats() {
    return this.orders.stats();
  }

  @Get('audit')
  audit(@Query('limit') limit?: string) {
    return this.orders.audit(Math.min(1000, Number(limit) || 300));
  }

  @Get('invoice/:userId')
  invoice(@Param('userId', ParseIntPipe) userId: number) {
    return this.orders.invoiceFor(userId);
  }

  @Post()
  create(@Body() dto: CreateOrderDto) {
    return this.orders.create(dto);
  }
}
