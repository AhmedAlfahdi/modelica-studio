/* Algebraic */
#include "BouncingBall_model.h"

#ifdef __cplusplus
extern "C" {
#endif

/* for continuous time variables */
int BouncingBall_functionAlgebraics(DATA *data, threadData_t *threadData)
{

#if !defined(OMC_MINIMAL_RUNTIME)
  if (measure_time_flag) rt_tick(SIM_TIMER_ALGEBRAICS);
#endif
  data->simulationInfo->callStatistics.functionAlgebraics++;

  BouncingBall_function_savePreSynchronous(data, threadData);
  
  /* no Alg systems */

#if !defined(OMC_MINIMAL_RUNTIME)
  if (measure_time_flag) rt_accumulate(SIM_TIMER_ALGEBRAICS);
#endif

  return 0;
}

#ifdef __cplusplus
}
#endif
