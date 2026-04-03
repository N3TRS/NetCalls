import { IsString, IsNotEmpty } from 'class-validator';

export class CallActionDto {
  @IsString()
  @IsNotEmpty()
  userId: string;
}
