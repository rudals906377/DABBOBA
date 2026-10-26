import type { ApiConfig } from '@dabboba/config';
import { AppError, badRequest } from './errors.js';
import { retiredNewPaymentRail, selectCardChannel } from './portone-channel-binding.js';

export function selectReviewPaymentRail(config: ApiConfig, provider: 'PORTONE_V2_NICE' | 'PORTONE_V2_KICC' | 'TOSSPAYMENTS_DIRECT') {
  if (config.environmentTier !== 'STAGING') throw badRequest('심사 결제사 선택은 시험 환경에서만 가능합니다.');
  // EasyPay (KICC) is retired for new payments; parseOrderInput rejects it first.
  if (provider === 'PORTONE_V2_KICC') throw retiredNewPaymentRail();
  if (provider === 'TOSSPAYMENTS_DIRECT' && ['TOSSPAYMENTS_DIRECT','PORTONE_V2_NICE'].includes(config.paymentProvider)
    && config.tossPayments?.environment === 'TEST') return {provider,cardChannel:null};
  if (provider === 'PORTONE_V2_NICE' && ['PORTONE_V2_NICE','PORTONE_V2_KICC'].includes(config.paymentProvider) && config.portOne?.channelEnvironment === 'TEST') {
    return {provider,cardChannel:selectCardChannel(config,'NICE')};
  }
  throw new AppError(503,'PAYMENT_NOT_CONFIGURED','선택한 심사 결제사의 TEST 연결을 준비 중이에요.');
}
