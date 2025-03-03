import { h } from 'preact';
import BaseElement from './BaseElement';
import { Order, PaymentAction } from '../types';
import getImage from '../utils/get-image';
import PayButton from './internal/PayButton';
import { IUIElement, UIElementProps } from './types';
import { getSanitizedResponse, resolveFinalResult } from './utils';
import AdyenCheckoutError from '../core/Errors/AdyenCheckoutError';
import { UIElementStatus } from './types';
import { hasOwnProperty } from '../utils/hasOwnProperty';

export class UIElement<P extends UIElementProps = any> extends BaseElement<P> implements IUIElement {
    protected componentRef: any;
    public elementRef: any;

    constructor(props: P) {
        super({ setStatusAutomatically: true, ...props });
        this.submit = this.submit.bind(this);
        this.setState = this.setState.bind(this);
        this.onValid = this.onValid.bind(this);
        this.onComplete = this.onComplete.bind(this);
        this.onSubmit = this.onSubmit.bind(this);
        this.handleAction = this.handleAction.bind(this);
        this.handleOrder = this.handleOrder.bind(this);
        this.handleResponse = this.handleResponse.bind(this);
        this.elementRef = (props && props.elementRef) || this;
    }

    public setState(newState: object): void {
        this.state = { ...this.state, ...newState };
        this.onChange();
    }

    protected onChange(): object {
        const isValid = this.isValid;
        const state = { data: this.data, errors: this.state.errors, valid: this.state.valid, isValid };
        if (this.props.onChange) this.props.onChange(state, this.elementRef);
        if (isValid) this.onValid();

        return state;
    }

    private onSubmit(): void {
        if (this.props.isInstantPayment) {
            this.elementRef.closeActivePaymentMethod();
        }

        if (this.props.setStatusAutomatically) {
            this.elementRef.setStatus('loading');
        }

        if (this.props.onSubmit) {
            // Classic flow
            this.props.onSubmit({ data: this.data, isValid: this.isValid }, this.elementRef);
        } else if (this._parentInstance.session) {
            // Session flow
            const beforeSubmitEvent = this.props.beforeSubmit
                ? new Promise((resolve, reject) => this.props.beforeSubmit(this.data, this.elementRef, { resolve, reject }))
                : Promise.resolve(this.data);

            beforeSubmitEvent.then(data => this.submitPayment(data)).catch(() => {});
        } else {
            this.handleError(new AdyenCheckoutError('IMPLEMENTATION_ERROR', 'Could not submit the payment'));
        }
    }

    private onValid() {
        const state = { data: this.data };
        if (this.props.onValid) this.props.onValid(state, this.elementRef);
        return state;
    }

    onComplete(state): void {
        if (this.props.onComplete) this.props.onComplete(state, this.elementRef);
    }

    /**
     * Submit payment method data. If the form is not valid, it will trigger validation.
     */
    public submit(): void {
        if (!this.isValid) {
            this.showValidation();
            return;
        }

        this.onSubmit();
    }

    public showValidation(): this {
        if (this.componentRef && this.componentRef.showValidation) this.componentRef.showValidation();
        return this;
    }

    public setStatus(status: UIElementStatus, props?): this {
        if (this.componentRef?.setStatus) {
            this.componentRef.setStatus(status, props);
        }
        return this;
    }

    private submitPayment(data): Promise<void> {
        return this._parentInstance.session
            .submitPayment(data)
            .then(this.handleResponse)
            .catch(error => this.handleError(error));
    }

    private submitAdditionalDetails(data): Promise<void> {
        return this._parentInstance.session
            .submitDetails(data)
            .then(this.handleResponse)
            .catch(this.handleError);
    }

    protected handleError = (error: AdyenCheckoutError): void => {
        /**
         * Set status using elementRef, which:
         * - If Drop-in, will set status for Dropin component, and then it will propagate the new status for the active payment method component
         * - If Component, it will set its own status
         */
        this.elementRef.setStatus('ready');

        if (this.props.onError) {
            this.props.onError(error, this.elementRef);
        }
    };

    protected handleAdditionalDetails = state => {
        if (this.props.onAdditionalDetails) {
            this.props.onAdditionalDetails(state, this.elementRef);
        } else if (this.props.session) {
            this.submitAdditionalDetails(state.data);
        }

        return state;
    };

    public handleAction(action: PaymentAction, props = {}): UIElement | null {
        if (!action || !action.type) {
            if (hasOwnProperty(action, 'action') && hasOwnProperty(action, 'resultCode')) {
                throw new Error(
                    'handleAction::Invalid Action - the passed action object itself has an "action" property and ' +
                        'a "resultCode": have you passed in the whole response object by mistake?'
                );
            }
            throw new Error('handleAction::Invalid Action - the passed action object does not have a "type" property');
        }

        const paymentAction = this._parentInstance.createFromAction(action, {
            ...props,
            onAdditionalDetails: this.handleAdditionalDetails
        });

        if (paymentAction) {
            this.unmount();
            return paymentAction.mount(this._node);
        }

        return null;
    }

    protected handleOrder = (order: Order): void => {
        this.elementRef._parentInstance.update({ order });
    };

    protected handleFinalResult = result => {
        if (this.props.setStatusAutomatically) {
            const [status, statusProps] = resolveFinalResult(result);
            if (status) this.elementRef.setStatus(status, statusProps);
        }

        if (this.props.onPaymentCompleted) this.props.onPaymentCompleted(result, this.elementRef);
        return result;
    };

    /**
     * Handles a session /payments or /payments/details response.
     * The component will handle automatically actions, orders, and final results.
     * @param rawResponse -
     */
    protected handleResponse(rawResponse): void {
        const response = getSanitizedResponse(rawResponse);

        if (response.action) {
            this.elementRef.handleAction(response.action);
        } else if (response.order?.remainingAmount?.value > 0) {
            this.elementRef.handleOrder(response.order);
        } else {
            this.elementRef.handleFinalResult(response);
        }
    }

    /**
     * Get the current validation status of the element
     */
    get isValid(): boolean {
        return false;
    }

    /**
     * Get the element icon URL for the current environment
     */
    get icon(): string {
        return this.props.icon ?? getImage({ loadingContext: this.props.loadingContext })(this.constructor['type']);
    }

    /**
     * Get the element's displayable name
     */
    get displayName(): string {
        return this.props.name || this.constructor['type'];
    }

    /**
     * Get the element accessible name, used in the aria-label of the button that controls selected payment method
     */
    get accessibleName(): string {
        return this.displayName;
    }

    /**
     * Return the type of an element
     */
    get type(): string {
        return this.props.type || this.constructor['type'];
    }

    /**
     * Get the payButton component for the current element
     */
    protected payButton = props => {
        return <PayButton {...props} amount={this.props.amount} onClick={this.submit} />;
    };
}

export default UIElement;
