from mobile_data_tracker.providers.carrier import CarrierProvider
from mobile_data_tracker.providers.carrier_parser import parse_usage


class MobileDataTracker:
    def __init__(self, provider: CarrierProvider) -> None:
        self._provider = provider

    def login(self) -> str:
        return self._provider.login()

    def get_access_token(self, *, auth_token: str) -> str:
        return self._provider.get_access_token(login_token=auth_token)

    def get_home(self, *, access_token: str) -> dict[str, object]:
        return self._provider.get_home(access_token=access_token)

    def get_usage_data(self) -> dict[str, object]:
        auth_token = self.login()
        access_token = self.get_access_token(auth_token=auth_token)
        home_response = self.get_home(access_token=access_token)
        return parse_usage(home_response)

    def close(self) -> None:
        self._provider.close()
