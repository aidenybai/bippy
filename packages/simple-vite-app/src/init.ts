import { instrument, secure } from 'bippy';

instrument(
  secure(
    {
      onActive: () => {
        console.log('onActive');
      },
    },
    {
      dangerouslyRunInProduction: true,
    },
  ),
);
