/* Main Simulation File */

#if defined(__cplusplus)
extern "C" {
#endif

#include "BouncingBall_model.h"
#include "simulation/solver/events.h"
#include "simulation/arrayIndex.h"

/* FIXME these defines are ugly and hard to read, why not use direct function pointers instead? */
#define prefixedName_performSimulation BouncingBall_performSimulation
#define prefixedName_updateContinuousSystem BouncingBall_updateContinuousSystem
#include <simulation/solver/perform_simulation.c.inc>

#define prefixedName_performQSSSimulation BouncingBall_performQSSSimulation
#include <simulation/solver/perform_qss_simulation.c.inc>


/* dummy VARINFO and FILEINFO */
const VAR_INFO dummyVAR_INFO = omc_dummyVarInfo;

int BouncingBall_input_function(DATA *data, threadData_t *threadData)
{
  
  return 0;
}

int BouncingBall_input_function_init(DATA *data, threadData_t *threadData)
{
  
  return 0;
}

int BouncingBall_input_function_updateStartValues(DATA *data, threadData_t *threadData)
{
  
  return 0;
}

int BouncingBall_inputNames(DATA *data, char ** names){
  
  return 0;
}

int BouncingBall_data_function(DATA *data, threadData_t *threadData)
{
  return 0;
}

int BouncingBall_dataReconciliationInputNames(DATA *data, char ** names){
  
  return 0;
}

int BouncingBall_dataReconciliationUnmeasuredVariables(DATA *data, char ** names)
{
  
  return 0;
}

int BouncingBall_output_function(DATA *data, threadData_t *threadData)
{
  
  return 0;
}

int BouncingBall_setc_function(DATA *data, threadData_t *threadData)
{
  
  return 0;
}

int BouncingBall_setb_function(DATA *data, threadData_t *threadData)
{
  
  return 0;
}


OMC_DISABLE_OPT
int BouncingBall_functionDAE(DATA *data, threadData_t *threadData)
{
  int equationIndexes[1] = {0};
#if !defined(OMC_MINIMAL_RUNTIME)
  if (measure_time_flag) rt_tick(SIM_TIMER_DAE);
#endif

  data->simulationInfo->needToIterate = 0;
  data->simulationInfo->discreteCall = 1;
  BouncingBall_functionLocalKnownVars(data, threadData);
  data->simulationInfo->discreteCall = 0;
  
#if !defined(OMC_MINIMAL_RUNTIME)
  if (measure_time_flag) rt_accumulate(SIM_TIMER_DAE);
#endif
  return 0;
}


int BouncingBall_functionLocalKnownVars(DATA *data, threadData_t *threadData)
{
  
  return 0;
}


int BouncingBall_functionODE(DATA *data, threadData_t *threadData)
{
#if !defined(OMC_MINIMAL_RUNTIME)
  if (measure_time_flag) rt_tick(SIM_TIMER_FUNCTION_ODE);
#endif

  
  data->simulationInfo->callStatistics.functionODE++;
  
  BouncingBall_functionLocalKnownVars(data, threadData);
  /* no ODE systems */

#if !defined(OMC_MINIMAL_RUNTIME)
  if (measure_time_flag) rt_accumulate(SIM_TIMER_FUNCTION_ODE);
#endif

  return 0;
}

void BouncingBall_ODE_DAG(DATA* data, threadData_t* threadData)
{
  const size_t eqMap[] = {};
  buildEvalDAG_ODE(data->modelData, sizeof(eqMap)/sizeof(size_t), eqMap);
}

/* forward the main in the simulation runtime */
extern int _main_SimulationRuntime(int argc, char **argv, DATA *data, threadData_t *threadData);
extern int _main_OptimizationRuntime(int argc, char **argv, DATA *data, threadData_t *threadData);

#include "BouncingBall_12jac.h"
#include "BouncingBall_13opt.h"

struct OpenModelicaGeneratedFunctionCallbacks BouncingBall_callback = {
  (int (*)(DATA *, threadData_t *, void *)) BouncingBall_performSimulation,    /* performSimulation */
  (int (*)(DATA *, threadData_t *, void *)) BouncingBall_performQSSSimulation,    /* performQSSSimulation */
  BouncingBall_updateContinuousSystem,    /* updateContinuousSystem */
  BouncingBall_callExternalObjectDestructors,    /* callExternalObjectDestructors */
  NULL,    /* initialNonLinearSystem */
  NULL,    /* initialLinearSystem */
  NULL,    /* initialMixedSystem */
  #if !defined(OMC_NO_STATESELECTION)
  BouncingBall_initializeStateSets,
  #else
  NULL,
  #endif    /* initializeStateSets */
  BouncingBall_initializeDAEmodeData,
  BouncingBall_ODE_DAG,
  BouncingBall_functionODE,
  BouncingBall_functionAlgebraics,
  BouncingBall_functionDAE,
  BouncingBall_functionLocalKnownVars,
  BouncingBall_input_function,
  BouncingBall_input_function_init,
  BouncingBall_input_function_updateStartValues,
  BouncingBall_data_function,
  BouncingBall_output_function,
  BouncingBall_setc_function,
  BouncingBall_setb_function,
  BouncingBall_function_storeDelayed,
  BouncingBall_function_storeSpatialDistribution,
  BouncingBall_function_initSpatialDistribution,
  BouncingBall_updateBoundVariableAttributes,
  BouncingBall_functionInitialEquations,
  GLOBAL_EQUIDISTANT_HOMOTOPY,
  NULL,
  BouncingBall_functionRemovedInitialEquations,
  BouncingBall_updateBoundParameters,
  BouncingBall_checkForAsserts,
  BouncingBall_function_ZeroCrossingsEquations,
  BouncingBall_function_ZeroCrossings,
  BouncingBall_function_updateRelations,
  BouncingBall_zeroCrossingDescription,
  BouncingBall_relationDescription,
  BouncingBall_function_initSample,
  BouncingBall_INDEX_JAC_A,
  BouncingBall_INDEX_JAC_ADJ,
  BouncingBall_INDEX_JAC_B,
  BouncingBall_INDEX_JAC_C,
  BouncingBall_INDEX_JAC_D,
  BouncingBall_INDEX_JAC_F,
  BouncingBall_INDEX_JAC_H,
  BouncingBall_initialAnalyticJacobianA,
  BouncingBall_initialAnalyticJacobianADJ,
  BouncingBall_initialAnalyticJacobianB,
  BouncingBall_initialAnalyticJacobianC,
  BouncingBall_initialAnalyticJacobianD,
  BouncingBall_initialAnalyticJacobianF,
  BouncingBall_initialAnalyticJacobianH,
  BouncingBall_functionJacA_column,
  BouncingBall_functionJacADJ_column,
  BouncingBall_functionJacB_column,
  BouncingBall_functionJacC_column,
  BouncingBall_functionJacD_column,
  BouncingBall_functionJacF_column,
  BouncingBall_functionJacH_column,
  BouncingBall_JacA_DAG,
  BouncingBall_linear_model_frame,
  BouncingBall_linear_model_datarecovery_frame,
  BouncingBall_mayer,
  BouncingBall_lagrange,
  BouncingBall_getInputVarIndicesInOptimization,
  BouncingBall_pickUpBoundsForInputsInOptimization,
  BouncingBall_setInputData,
  BouncingBall_getTimeGrid,
  BouncingBall_symbolicInlineSystem,
  BouncingBall_function_initSynchronous,
  BouncingBall_function_updateSynchronous,
  BouncingBall_function_equationsSynchronous,
  BouncingBall_inputNames,
  BouncingBall_dataReconciliationInputNames,
  BouncingBall_dataReconciliationUnmeasuredVariables,
  NULL,
  NULL,
  NULL,
  NULL,
  -1,
  NULL,
  NULL,
  -1

};

#define _OMC_LIT_RESOURCE_0_name_data "BouncingBall"
#define _OMC_LIT_RESOURCE_0_dir_data "/tmp"
static const MMC_DEFSTRINGLIT(_OMC_LIT_RESOURCE_0_name,12,_OMC_LIT_RESOURCE_0_name_data);
static const MMC_DEFSTRINGLIT(_OMC_LIT_RESOURCE_0_dir,4,_OMC_LIT_RESOURCE_0_dir_data);

static const MMC_DEFSTRUCTLIT(_OMC_LIT_RESOURCES,2,MMC_ARRAY_TAG) {MMC_REFSTRINGLIT(_OMC_LIT_RESOURCE_0_name), MMC_REFSTRINGLIT(_OMC_LIT_RESOURCE_0_dir)}};
void BouncingBall_setupDataStruc(DATA *data, threadData_t *threadData)
{
  assertStreamPrint(threadData,0!=data, "Error while initialize Data");
  threadData->localRoots[LOCAL_ROOT_SIMULATION_DATA] = data;
  data->callback = &BouncingBall_callback;
  OpenModelica_updateUriMapping(threadData, MMC_REFSTRUCTLIT(_OMC_LIT_RESOURCES));
  data->modelData->modelName = "BouncingBall";
  data->modelData->modelFilePrefix = "BouncingBall";
  data->modelData->modelFileName = "empty.mo";
  data->modelData->resultFileName = NULL;
  data->modelData->modelDir = "/tmp";
  data->modelData->modelGUID = "{3ace24fb-b0cc-480b-a44a-02ab209d3f4f}";
  #if defined(OPENMODELICA_XML_FROM_FILE_AT_RUNTIME)
  data->modelData->initXMLData = NULL;
  data->modelData->modelDataXml.infoXMLData = NULL;
  #else
  #if defined(_MSC_VER) /* handle joke compilers */
  {
  /* for MSVC we encode a string like char x[] = {'a', 'b', 'c', '\0'} */
  /* because the string constant limit is 65535 bytes */
  static const char contents_init[] =
    #include "BouncingBall_init.c"
    ;
  static const char contents_info[] =
    #include "BouncingBall_info.c"
    ;
    data->modelData->initXMLData = contents_init;
    data->modelData->modelDataXml.infoXMLData = contents_info;
  }
  #else /* handle real compilers */
  data->modelData->initXMLData =
  #include "BouncingBall_init.c"
    ;
  data->modelData->modelDataXml.infoXMLData =
  #include "BouncingBall_info.c"
    ;
  #endif /* defined(_MSC_VER) */
  #endif /* defined(OPENMODELICA_XML_FROM_FILE_AT_RUNTIME) */
  data->modelData->modelDataXml.fileName = "BouncingBall_info.json";
  data->modelData->resourcesDir = NULL;
  data->modelData->runTestsuite = 0;
  data->modelData->nStatesArray = 0;
  data->modelData->nDiscreteReal = 0;
  data->modelData->nVariablesRealArray = 0;
  data->modelData->nVariablesIntegerArray = 0;
  data->modelData->nVariablesBooleanArray = 0;
  data->modelData->nVariablesStringArray = 0;
  data->modelData->nParametersRealArray = 0;
  data->modelData->nParametersIntegerArray = 0;
  data->modelData->nParametersBooleanArray = 0;
  data->modelData->nParametersStringArray = 0;
  data->modelData->nParametersReal = 0;
  data->modelData->nParametersInteger = 0;
  data->modelData->nParametersBoolean = 0;
  data->modelData->nParametersString = 0;
  data->modelData->nAliasRealArray = 0;
  data->modelData->nAliasIntegerArray = 0;
  data->modelData->nAliasBooleanArray = 0;
  data->modelData->nAliasStringArray = 0;
  data->modelData->nInputVars = 0;
  data->modelData->nOutputVars = 0;
  data->modelData->nZeroCrossings = 0;
  data->modelData->nSamples = 0;
  data->modelData->nRelations = 0;
  data->modelData->nMathEvents = 0;
  data->modelData->nExtObjs = 0;
  data->modelData->modelDataXml.modelInfoXmlLength = 0;
  data->modelData->modelDataXml.nFunctions = 0;
  data->modelData->modelDataXml.nProfileBlocks = 0;
  data->modelData->modelDataXml.nEquations = 1;
  data->modelData->nMixedSystems = 0;
  data->modelData->nLinearSystems = 0;
  data->modelData->nNonLinearSystems = 0;
  data->modelData->nStateSets = 0;
  data->modelData->nJacobians = 7;
  data->modelData->nOptimizeConstraints = 0;
  data->modelData->nOptimizeFinalConstraints = 0;
  data->modelData->nDelayExpressions = 0;
  data->modelData->nBaseClocks = 0;
  data->modelData->nSpatialDistributions = 0;
  data->modelData->nSensitivityVars = 0;
  data->modelData->nSensitivityParamVars = 0;
  data->modelData->nSetcVars = 0;
  data->modelData->ndataReconVars = 0;
  data->modelData->nSetbVars = 0;
  data->modelData->nRelatedBoundaryConditions = 0;
  data->modelData->linearizationDumpLanguage = OMC_LINEARIZE_DUMP_LANGUAGE_MODELICA;
}

static int rml_execution_failed()
{
  fflush(NULL);
  fprintf(stderr, "Execution failed!\n");
  fflush(NULL);
  return 1;
}


#if defined(__MINGW32__) || defined(_MSC_VER)

#if !defined(_UNICODE)
#define _UNICODE
#endif
#if !defined(UNICODE)
#define UNICODE
#endif

#include <windows.h>
char** omc_fixWindowsArgv(int argc, wchar_t **wargv)
{
  char** newargv;
  /* Support for non-ASCII characters
  * Read the unicode command line arguments and translate it to char*
  */
  newargv = (char**)malloc(argc*sizeof(char*));
  for (int i = 0; i < argc; i++) {
    newargv[i] = omc_wchar_to_multibyte_str(wargv[i]);
  }
  return newargv;
}

#define OMC_MAIN wmain
#define OMC_CHAR wchar_t
#define OMC_EXPORT __declspec(dllexport) extern

#else
#define omc_fixWindowsArgv(N, A) (A)
#define OMC_MAIN main
#define OMC_CHAR char
#define OMC_EXPORT extern
#endif

#if defined(threadData)
#undef threadData
#endif
/* call the simulation runtime main from our main! */
#if defined(OMC_DLL_MAIN_DEFINE)
OMC_EXPORT int omcDllMain(int argc, OMC_CHAR **argv)
#else
int OMC_MAIN(int argc, OMC_CHAR** argv)
#endif
{
  char** newargv = omc_fixWindowsArgv(argc, argv);
  /*
    Set the error functions to be used for simulation.
    The default value for them is 'functions' version. Change it here to 'simulation' versions
  */
  omc_assert = omc_assert_simulation;
  omc_assert_withEquationIndexes = omc_assert_simulation_withEquationIndexes;

  omc_assert_warning_withEquationIndexes = omc_assert_warning_simulation_withEquationIndexes;
  omc_assert_warning = omc_assert_warning_simulation;
  omc_terminate = omc_terminate_simulation;
  omc_throw = omc_throw_simulation;

  int res;
  DATA data;
  MODEL_DATA modelData;
  SIMULATION_INFO simInfo;
  data.modelData = &modelData;
  data.simulationInfo = &simInfo;
  measure_time_flag = 0;
  compiledInDAEMode = 0;
  compiledWithSymSolver = 0;
  MMC_INIT(0);
  omc_alloc_interface.init();
  {
    MMC_TRY_TOP()
  
    MMC_TRY_STACK()
  
    BouncingBall_setupDataStruc(&data, threadData);
    res = _main_initRuntimeAndSimulation(argc, newargv, &data, threadData);
    if(res == 0) {
      if (omc_flag[FLAG_MOO_OPTIMIZATION]) {
        res = _main_OptimizationRuntime(argc, newargv, &data, threadData);
      } else {
        res = _main_SimulationRuntime(argc, newargv, &data, threadData);
      }
    }
    
    MMC_ELSE()
    rml_execution_failed();
    fprintf(stderr, "Stack overflow detected and was not caught.\nSend us a bug report at https://trac.openmodelica.org/OpenModelica/newticket\n    Include the following trace:\n");
    printStacktraceMessages();
    fflush(NULL);
    return 1;
    MMC_CATCH_STACK()
    
    MMC_CATCH_TOP(return rml_execution_failed());
  }

  fflush(NULL);
  return res;
}

#ifdef __cplusplus
}
#endif


