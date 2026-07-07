import { type Consultation, type ConsultationSnapshot } from './types'

/**
 * Consultation flow seed. Starts empty — real consultations are created by
 * staff as customers move through the advisory journey.
 */

const consultations: Consultation[] = []

export const consultationSeed: ConsultationSnapshot = {
  consultations,
  selectedConsultationId: null,
  eventLog: []
}
