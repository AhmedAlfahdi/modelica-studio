/* Initialization */
#include "BouncingBall_model.h"
#include "BouncingBall_11mix.h"
#include "BouncingBall_12jac.h"
#if defined(__cplusplus)
extern "C" {
#endif


int BouncingBall_functionInitialEquations(DATA *data, threadData_t *threadData)
{
  data->simulationInfo->discreteCall = 1;
  data->simulationInfo->discreteCall = 0;
  
  return 0;
}

/* No BouncingBall_functionInitialEquations_lambda0 function */

int BouncingBall_functionRemovedInitialEquations(DATA *data, threadData_t *threadData)
{
  const int *equationIndexes = NULL;
  double res = 0.0;

  
  return 0;
}


#if defined(__cplusplus)
}
#endif
