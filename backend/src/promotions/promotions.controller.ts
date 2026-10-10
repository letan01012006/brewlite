import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PromotionsService } from './promotions.service.js';
import { ValidatePromotionDto } from './dto/apply-promotion.dto.js';

@ApiTags('promotions')
@Controller('promotions')
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  /**
   * Xem trước số tiền giảm ở trang giỏ hàng (Task 10 - Mục 6.7)
   * POST /api/promotions/validate
   */
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Kiểm tra tính hợp lệ và xem trước số tiền giảm của mã khuyến mãi',
  })
  @ApiResponse({
    status: 200,
    description: 'Mã hợp lệ, trả về số tiền được giảm và tổng sau giảm',
  })
  @ApiResponse({ status: 400, description: 'Dữ liệu giỏ hàng hoặc mã không đúng định dạng' })
  @ApiResponse({
    status: 422,
    description: 'Mã không tồn tại, hết hạn, hết lượt, hoặc đơn chưa đạt giá trị tối thiểu',
  })
  async validatePromotion(@Body() dto: ValidatePromotionDto) {
    return this.promotionsService.validatePromotion(dto);
  }
}
