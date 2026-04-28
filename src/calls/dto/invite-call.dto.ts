import { IsString, IsArray, ArrayMinSize, IsNotEmpty } from 'class-validator';

export class InviteCallDto {
  @IsString()
  @IsNotEmpty()
  inviterId: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'At least one invitee is required' })
  @IsString({ each: true })
  inviteeIds: string[];
}
