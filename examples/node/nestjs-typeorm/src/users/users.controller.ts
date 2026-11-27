import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.users.getById(id);
  }
}
